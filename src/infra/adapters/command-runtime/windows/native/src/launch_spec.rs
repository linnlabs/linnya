use napi_derive::napi;

use crate::error::{NativeError, NativeResult};

const WINDOWS_COMMAND_LINE_MAX_UTF16_UNITS: usize = 32_767;

#[napi(object)]
pub struct WindowsEnvironmentEntry {
    pub name: String,
    pub value: String,
}

#[napi(object)]
pub struct WindowsOwnedPipeLaunchInput {
    pub executable_path: String,
    pub argv: Vec<String>,
    pub cwd: String,
    pub environment: Vec<WindowsEnvironmentEntry>,
}

#[cfg(target_os = "windows")]
pub(crate) struct NativeLaunchSpec {
    pub(crate) executable_path: Vec<u16>,
    pub(crate) command_line: Vec<u16>,
    pub(crate) cwd: Vec<u16>,
    pub(crate) environment: Vec<u16>,
}

fn quote_windows_argument(argument: &str) -> String {
    if !argument.is_empty()
        && !argument
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return argument.to_owned();
    }

    let mut quoted = String::from("\"");
    let mut pending_backslashes = 0usize;
    for character in argument.chars() {
        if character == '\\' {
            pending_backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.push_str(&"\\".repeat(pending_backslashes * 2 + 1));
            quoted.push('"');
        } else {
            quoted.push_str(&"\\".repeat(pending_backslashes));
            quoted.push(character);
        }
        pending_backslashes = 0;
    }
    quoted.push_str(&"\\".repeat(pending_backslashes * 2));
    quoted.push('"');
    quoted
}

fn encode_nul_terminated(value: &str, stage: &'static str) -> NativeResult<Vec<u16>> {
    if value.contains('\0') {
        return Err(NativeError::contract(stage, "value contains NUL"));
    }
    let mut encoded: Vec<u16> = value.encode_utf16().collect();
    encoded.push(0);
    Ok(encoded)
}

fn build_command_line(executable_path: &str, argv: &[String]) -> NativeResult<Vec<u16>> {
    let mut values = Vec::with_capacity(argv.len() + 1);
    values.push(quote_windows_argument(executable_path));
    values.extend(argv.iter().map(|value| quote_windows_argument(value)));
    let command_line = values.join(" ");
    let encoded = encode_nul_terminated(&command_line, "command_line")?;
    if encoded.len() > WINDOWS_COMMAND_LINE_MAX_UTF16_UNITS {
        return Err(NativeError::contract(
            "command_line",
            format!(
                "payload has {} UTF-16 units; maximum including NUL is {WINDOWS_COMMAND_LINE_MAX_UTF16_UNITS}",
                encoded.len(),
            ),
        ));
    }
    Ok(encoded)
}

fn validate_environment_entry(entry: &WindowsEnvironmentEntry) -> NativeResult<()> {
    if entry.name.is_empty() || entry.name.contains('=') || entry.name.contains('\0') {
        return Err(NativeError::contract(
            "environment",
            format!("invalid environment name: {:?}", entry.name),
        ));
    }
    if entry.value.contains('\0') {
        return Err(NativeError::contract(
            "environment",
            format!("environment value for {:?} contains NUL", entry.name),
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn compare_environment_names(left: &str, right: &str) -> NativeResult<std::cmp::Ordering> {
    use windows_sys::Win32::Globalization::{
        CSTR_EQUAL, CSTR_GREATER_THAN, CSTR_LESS_THAN, CompareStringOrdinal,
    };

    let left_utf16: Vec<u16> = left.encode_utf16().collect();
    let right_utf16: Vec<u16> = right.encode_utf16().collect();
    // SAFETY: 两个 UTF-16 Vec 在调用期间保持存活，传入的显式长度均与对应 buffer 一致；
    // CompareStringOrdinal 只读取这些内存，不要求 NUL 结尾。
    let comparison = unsafe {
        CompareStringOrdinal(
            left_utf16.as_ptr(),
            left_utf16.len() as i32,
            right_utf16.as_ptr(),
            right_utf16.len() as i32,
            1,
        )
    };
    match comparison {
        CSTR_LESS_THAN => Ok(std::cmp::Ordering::Less),
        CSTR_EQUAL => Ok(std::cmp::Ordering::Equal),
        CSTR_GREATER_THAN => Ok(std::cmp::Ordering::Greater),
        _ => Err(NativeError::last_win32("environment_compare")),
    }
}

#[cfg(not(target_os = "windows"))]
fn compare_environment_names(left: &str, right: &str) -> NativeResult<std::cmp::Ordering> {
    Ok(left.to_ascii_uppercase().cmp(&right.to_ascii_uppercase()))
}

fn order_environment_entries(
    entries: Vec<WindowsEnvironmentEntry>,
) -> NativeResult<Vec<WindowsEnvironmentEntry>> {
    let mut ordered = Vec::<WindowsEnvironmentEntry>::with_capacity(entries.len());
    for entry in entries {
        validate_environment_entry(&entry)?;
        let mut insertion_index = ordered.len();
        for (index, existing) in ordered.iter().enumerate() {
            match compare_environment_names(&entry.name, &existing.name)? {
                std::cmp::Ordering::Less => {
                    insertion_index = index;
                    break;
                }
                std::cmp::Ordering::Equal => {
                    return Err(NativeError::contract(
                        "environment",
                        "environment contains Windows case-insensitive duplicate names",
                    ));
                }
                std::cmp::Ordering::Greater => {}
            }
        }
        ordered.insert(insertion_index, entry);
    }
    Ok(ordered)
}

fn build_environment_block(entries: Vec<WindowsEnvironmentEntry>) -> NativeResult<Vec<u16>> {
    let mut block = Vec::<u16>::new();
    for entry in order_environment_entries(entries)? {
        if entry.name.starts_with('=') {
            return Err(NativeError::contract(
                "environment",
                "drive-current-directory pseudo variables are not accepted",
            ));
        }
        block.extend(format!("{}={}", entry.name, entry.value).encode_utf16());
        block.push(0);
    }
    block.push(0);
    if block.len() == 1 {
        block.push(0);
    }
    Ok(block)
}

impl WindowsOwnedPipeLaunchInput {
    #[cfg(target_os = "windows")]
    pub(crate) fn into_native(self) -> NativeResult<NativeLaunchSpec> {
        if self.executable_path.is_empty() {
            return Err(NativeError::contract("executable_path", "path is empty"));
        }
        if self.cwd.is_empty() {
            return Err(NativeError::contract("cwd", "path is empty"));
        }
        Ok(NativeLaunchSpec {
            command_line: build_command_line(&self.executable_path, &self.argv)?,
            executable_path: encode_nul_terminated(&self.executable_path, "executable_path")?,
            cwd: encode_nul_terminated(&self.cwd, "cwd")?,
            environment: build_environment_block(self.environment)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        WINDOWS_COMMAND_LINE_MAX_UTF16_UNITS, WindowsEnvironmentEntry, build_command_line,
        build_environment_block,
    };

    fn decode(value: Vec<u16>) -> String {
        String::from_utf16(&value[..value.len() - 1]).expect("valid UTF-16")
    }

    #[test]
    fn quotes_empty_spaces_quotes_and_trailing_backslashes() {
        let encoded = build_command_line(
            r#"C:\Program Files\PowerShell\pwsh.exe"#,
            &[
                String::new(),
                "plain".to_owned(),
                "two words".to_owned(),
                r#"quote"inside"#.to_owned(),
                r#"C:\tail\"#.to_owned(),
                "中文".to_owned(),
            ],
        )
        .expect("command line");
        assert_eq!(
            decode(encoded),
            r#""C:\Program Files\PowerShell\pwsh.exe" "" plain "two words" "quote\"inside" C:\tail\ 中文"#,
        );
    }

    #[test]
    fn environment_is_case_insensitive_and_double_nul_terminated() {
        let block = build_environment_block(vec![
            WindowsEnvironmentEntry {
                name: "Path".to_owned(),
                value: "C:\\Tools".to_owned(),
            },
            WindowsEnvironmentEntry {
                name: "中文变量".to_owned(),
                value: "值".to_owned(),
            },
        ])
        .expect("environment");
        assert_eq!(&block[block.len() - 2..], &[0, 0]);

        let duplicate = build_environment_block(vec![
            WindowsEnvironmentEntry {
                name: "PATH".to_owned(),
                value: "a".to_owned(),
            },
            WindowsEnvironmentEntry {
                name: "Path".to_owned(),
                value: "b".to_owned(),
            },
        ]);
        assert!(duplicate.is_err());
    }

    #[test]
    fn command_line_budget_counts_final_quoting_and_terminating_nul() {
        let executable = "x";
        // `x ` 与结尾 NUL 各占一个 UTF-16 单元，payload 正好填满其余预算。
        let accepted_payload = "a".repeat(WINDOWS_COMMAND_LINE_MAX_UTF16_UNITS - 3);
        let accepted = build_command_line(executable, &[accepted_payload]).expect("boundary");
        assert_eq!(accepted.len(), WINDOWS_COMMAND_LINE_MAX_UTF16_UNITS);

        let rejected_payload = "a".repeat(WINDOWS_COMMAND_LINE_MAX_UTF16_UNITS - 2);
        let rejected = build_command_line(executable, &[rejected_payload]);
        let message = rejected.expect_err("overlong command line").to_string();
        assert!(message.contains("stage=command_line"));
        assert!(message.contains("maximum including NUL is 32767"));
    }
}
