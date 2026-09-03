use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

const PROTOCOL_VERSION: u8 = 1;
const ENDPOINT_ENV: &str = "LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT";
const TOKEN_ENV: &str = "LINNYA_INTERNAL_PLUGIN_CLI_TOKEN";
const TOKEN_HEADER: &str = "X-Linnya-Plugin-Cli-Token";
const MAX_RESPONSE_BYTES: usize = 12 * 1024 * 1024;
const MAX_OUTPUT_FRAME_BYTES: usize = 64 * 1024;
const TRANSPORT_FAILURE_EXIT_CODE: u8 = 70;

#[derive(Debug)]
struct Endpoint {
    host: String,
    port: u16,
    path: String,
}

#[derive(Serialize)]
struct InvocationRequest<'a> {
    protocol_version: u8,
    kind: &'static str,
    plugin_id: &'a str,
    argv: &'a [String],
}

#[derive(Deserialize)]
#[serde(tag = "kind")]
enum BridgeFrame {
    #[serde(rename = "plugin_cli_output")]
    Output {
        protocol_version: u8,
        channel: OutputChannel,
        bytes_base64: String,
    },
    #[serde(rename = "plugin_cli_terminal")]
    Terminal { protocol_version: u8, exit_code: u8 },
    #[serde(rename = "plugin_cli_failure")]
    Failure {
        protocol_version: u8,
        code: String,
        message: String,
        exit_code: u8,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum OutputChannel {
    Stdout,
    Stderr,
}

fn parse_endpoint(value: &str) -> Result<Endpoint, ()> {
    let authority_and_path = value.strip_prefix("http://").ok_or(())?;
    let (authority, path_suffix) = authority_and_path.split_once('/').ok_or(())?;
    let (host, port_text) = authority.rsplit_once(':').ok_or(())?;
    if host != "127.0.0.1" {
        return Err(());
    }
    let port = port_text.parse::<u16>().map_err(|_| ())?;
    if port == 0 || path_suffix.is_empty() {
        return Err(());
    }
    Ok(Endpoint {
        host: host.to_owned(),
        port,
        path: format!("/{path_suffix}"),
    })
}

fn connect(endpoint: &Endpoint) -> Result<TcpStream, ()> {
    let address = format!("{}:{}", endpoint.host, endpoint.port);
    let socket_address = address
        .to_socket_addrs()
        .map_err(|_| ())?
        .next()
        .ok_or(())?;
    let stream =
        TcpStream::connect_timeout(&socket_address, Duration::from_secs(3)).map_err(|_| ())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(300)))
        .map_err(|_| ())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|_| ())?;
    Ok(stream)
}

fn read_response(mut stream: TcpStream) -> Result<u8, ()> {
    let mut reader = BufReader::new(&mut stream);
    let mut status_line = String::new();
    reader.read_line(&mut status_line).map_err(|_| ())?;
    let mut status_parts = status_line.split_ascii_whitespace();
    if status_parts.next() != Some("HTTP/1.1") {
        return Err(());
    }
    let status = status_parts
        .next()
        .ok_or(())?
        .parse::<u16>()
        .map_err(|_| ())?;
    let mut content_length: Option<usize> = None;
    loop {
        let mut header = String::new();
        reader.read_line(&mut header).map_err(|_| ())?;
        if header == "\r\n" {
            break;
        }
        let (name, value) = header.split_once(':').ok_or(())?;
        if name.eq_ignore_ascii_case("content-length") {
            let parsed = value.trim().parse::<usize>().map_err(|_| ())?;
            if parsed > MAX_RESPONSE_BYTES {
                return Err(());
            }
            content_length = Some(parsed);
        }
    }
    let length = content_length.ok_or(())?;
    if status != 200 {
        return Err(());
    }

    let mut body = reader.take(length as u64);
    let mut terminal_exit_code: Option<u8> = None;
    loop {
        let mut line = String::new();
        let observed = body.read_line(&mut line).map_err(|_| ())?;
        if observed == 0 {
            break;
        }
        if terminal_exit_code.is_some() || !line.ends_with('\n') {
            return Err(());
        }
        let frame: BridgeFrame = serde_json::from_str(line.trim_end()).map_err(|_| ())?;
        match frame {
            BridgeFrame::Output {
                protocol_version,
                channel,
                bytes_base64,
            } => {
                if protocol_version != PROTOCOL_VERSION {
                    return Err(());
                }
                let bytes = BASE64.decode(bytes_base64).map_err(|_| ())?;
                if bytes.is_empty() || bytes.len() > MAX_OUTPUT_FRAME_BYTES {
                    return Err(());
                }
                match channel {
                    OutputChannel::Stdout => std::io::stdout().write_all(&bytes).map_err(|_| ())?,
                    OutputChannel::Stderr => std::io::stderr().write_all(&bytes).map_err(|_| ())?,
                }
            }
            BridgeFrame::Terminal {
                protocol_version,
                exit_code,
            } => {
                if protocol_version != PROTOCOL_VERSION {
                    return Err(());
                }
                terminal_exit_code = Some(exit_code);
            }
            BridgeFrame::Failure {
                protocol_version,
                code,
                message,
                exit_code,
            } => {
                if protocol_version != PROTOCOL_VERSION
                    || !code
                        .chars()
                        .all(|character| character.is_ascii_lowercase() || character == '_')
                {
                    return Err(());
                }
                eprintln!("plugin.cli.bridge_{code}: {message}");
                terminal_exit_code = Some(exit_code);
            }
        }
    }
    if body.limit() != 0 {
        return Err(());
    }
    terminal_exit_code.ok_or(())
}

fn invoke(endpoint: &Endpoint, token: &str, plugin_id: &str, argv: &[String]) -> Result<u8, ()> {
    let body = serde_json::to_vec(&InvocationRequest {
        protocol_version: PROTOCOL_VERSION,
        kind: "plugin_cli_invoke",
        plugin_id,
        argv,
    })
    .map_err(|_| ())?;
    let mut stream = connect(endpoint)?;
    write!(
        stream,
        "POST {} HTTP/1.1\r\nHost: {}:{}\r\nContent-Type: application/json\r\n{}: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        endpoint.path,
        endpoint.host,
        endpoint.port,
        TOKEN_HEADER,
        token,
        body.len(),
    )
    .map_err(|_| ())?;
    stream.write_all(&body).map_err(|_| ())?;
    stream.flush().map_err(|_| ())?;

    read_response(stream)
}

fn run() -> Result<u8, ()> {
    let endpoint = parse_endpoint(&env::var(ENDPOINT_ENV).map_err(|_| ())?)?;
    let token = env::var(TOKEN_ENV).map_err(|_| ())?;
    if token.is_empty() || token.contains('\r') || token.contains('\n') {
        return Err(());
    }
    let executable = env::args_os().next().ok_or(())?;
    let executable_stem = Path::new(&executable)
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or(())?;
    let plugin_id = executable_stem.strip_prefix("linnya-").ok_or(())?;
    if plugin_id == "plugin-cli-client" {
        return Err(());
    }
    let mut plugin_id_characters = plugin_id.chars();
    if !plugin_id_characters
        .next()
        .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        || plugin_id.len() > 128
        || !plugin_id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || "._-".contains(character)
        })
    {
        return Err(());
    }
    // Unix argv 允许非 UTF-8 字节；bridge JSON 不允许。显式拒绝而不是让 env::args() panic，
    // 保持所有 client-side 输入失败都落到稳定 transport exit code。
    let argv: Vec<String> = env::args_os()
        .skip(1)
        .map(|argument| argument.into_string().map_err(|_| ()))
        .collect::<Result<_, _>>()?;
    if argv.len() > 64 || argv.iter().any(|argument| argument.chars().count() > 4096) {
        return Err(());
    }
    invoke(&endpoint, &token, plugin_id, &argv)
}

fn main() -> ExitCode {
    match run() {
        Ok(exit_code) => ExitCode::from(exit_code),
        Err(()) => {
            eprintln!("plugin.cli.bridge_transport_failure: Plugin CLI bridge is unavailable");
            ExitCode::from(TRANSPORT_FAILURE_EXIT_CODE)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_endpoint;

    #[test]
    fn endpoint_only_accepts_loopback_http_and_an_explicit_path() {
        let parsed = parse_endpoint("http://127.0.0.1:43123/v1/plugin-cli/invoke").unwrap();
        assert_eq!(parsed.host, "127.0.0.1");
        assert_eq!(parsed.port, 43123);
        assert_eq!(parsed.path, "/v1/plugin-cli/invoke");
        assert!(parse_endpoint("http://localhost:43123/v1/plugin-cli/invoke").is_err());
        assert!(parse_endpoint("https://127.0.0.1:43123/v1/plugin-cli/invoke").is_err());
        assert!(parse_endpoint("http://127.0.0.1:0/v1/plugin-cli/invoke").is_err());
    }
}
