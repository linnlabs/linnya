//! Windows 桌面用户集成探针：使用正式账户服务、worker 和正式命令 Job，输出只含合成数据。
#[cfg(windows)]
fn main() {
    use linnya_windows_command_isolation::{
        AccountLease, FilesystemLease, FilesystemPolicy, WorkerProgram, WorkerTerminalSize,
        close_terminal, create_suspended_worker, prepare_worker, resize_terminal,
    };
    use std::io::{Read, Write};
    use std::os::windows::io::AsRawHandle;
    use std::path::PathBuf;
    use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, ResumeThread, WaitForSingleObject,
    };
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    assert!(
        (3..=4).contains(&arguments.len()),
        "expected helper node fixture-directory [pty]"
    );
    let pty = arguments.get(3).is_some_and(|mode| mode == "pty");
    let root = PathBuf::from(&arguments[2]);
    std::fs::create_dir_all(root.join("current")).expect("fixture directory");
    std::fs::write(root.join("secret.txt"), "SYNTHETIC_SECRET").expect("canary");
    std::fs::write(root.join("current/input.txt"), "INPUT").expect("input");
    let lease = AccountLease::acquire().expect("acquire account");
    let filesystem = FilesystemLease::acquire(
        &lease,
        FilesystemPolicy {
            protected_roots: vec![root.clone()],
            readable_roots: vec![root.join("current")],
            write_roots: vec![root.join("current")],
        },
    )
    .expect("prepare explicit file boundary");
    let mut script = String::from(
        r#"const fs=require('fs'),cp=require('child_process');
console.log('INPUT='+fs.readFileSync('input.txt','utf8'));
try {fs.readFileSync('../secret.txt');throw Error('SECRET LEAK')}catch(e){if(e.code!=='EACCES'&&e.code!=='EPERM')throw e;console.log('SECRET_DENIED')}
const child=cp.spawnSync(process.execPath,['-e',`const fs=require('fs');try{fs.readFileSync('../secret.txt');process.exit(99)}catch(e){if(e.code!=='EACCES'&&e.code!=='EPERM')throw e;console.log('CHILD_DENIED')}`],{encoding:'utf8'});
if(child.error)throw child.error;if(child.status!==0)throw Error('child '+child.status);process.stdout.write(child.stdout);
fs.writeFileSync('result.txt','OK');console.log('CURRENT_WRITE=OK');
"#,
    );
    if pty {
        script.push_str("if(process.stdin.isTTY!==true)throw Error('not a TTY');console.log('PTY_TTY=true');process.stdin.once('data',d=>{console.log('PTY_INPUT='+d.toString().trim());console.log('PTY_SIZE='+process.stdout.columns+'x'+process.stdout.rows);process.exit(0)});");
    }
    let cwd = srt_win::util::wstr(&root.join("current").to_string_lossy());
    let command =
        srt_win::launch::build_cmdline(std::path::Path::new(&arguments[1]), &["-e".into(), script]);
    let mut environment = Vec::new();
    let mut entries: Vec<_> = std::env::vars().collect();
    entries.sort_by_key(|(key, _)| key.to_uppercase());
    for (key, value) in entries {
        environment.extend(format!("{key}={value}").encode_utf16());
        environment.push(0);
    }
    environment.push(0);
    let program = WorkerProgram {
        executable_path: srt_win::util::wstr(&arguments[1]),
        command_line: srt_win::util::wstr(&command),
        cwd: cwd.clone(),
        environment: zeroize::Zeroizing::new(environment),
        terminal: pty.then_some(WorkerTerminalSize {
            columns: 80,
            rows: 24,
        }),
    };
    let worker = create_suspended_worker(std::path::Path::new(&arguments[0]), &program, lease)
        .expect("create worker with owned Jobs");
    let prepared = prepare_worker(worker, &program).expect("prepare real root suspended");
    let root_process = prepared.root_process;
    let root_thread = prepared.root_thread;
    let linnya_windows_command_isolation::SuspendedWorker {
        lease,
        job,
        worker_job,
        handles: _,
        process,
        thread,
        mut stdin,
        mut stdout,
        mut stderr,
        mut status,
        mut terminal_input,
        desktop,
    } = prepared.worker;
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).expect("stdout");
        bytes
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).expect("stderr");
        bytes
    });
    if pty {
        resize_terminal(
            &mut stdin,
            &mut status,
            WorkerTerminalSize {
                columns: 100,
                rows: 36,
            },
        )
        .expect("resize actual ConPTY");
    }
    // SAFETY: fixture 保活暂停的真实根命令线程，并且只恢复一次。
    assert_eq!(
        unsafe { ResumeThread(HANDLE(root_thread.as_raw_handle())) },
        1
    );
    if let Some(input) = terminal_input.as_mut() {
        input.write_all(b"hello\r").expect("terminal input");
    }
    // SAFETY: fixture 保活真实根进程句柄，超时由 close/release 的 Job 清理处理。
    let waited = unsafe { WaitForSingleObject(HANDLE(root_process.as_raw_handle()), 15_000) };
    drop(terminal_input.take());
    if pty {
        close_terminal(&mut stdin).expect("close actual ConPTY after root exit");
    }
    drop(stdin);
    // SAFETY: worker 在关闭 ConPTY/真实根完成后退出，不把它的 PID 当作用户命令根事实。
    let worker_waited = unsafe { WaitForSingleObject(HANDLE(process.as_raw_handle()), 5_000) };
    let mut exit_code = 0;
    // SAFETY: process 仍保活，exit_code 为有效输出地址。
    unsafe { GetExitCodeProcess(HANDLE(process.as_raw_handle()), &mut exit_code) }
        .expect("worker exit");
    drop((
        root_process,
        root_thread,
        process,
        thread,
        status,
        terminal_input,
    ));
    let permissions = filesystem.release();
    let cleanup = lease.release();
    let output = out.join().expect("stdout observer");
    let output = String::from_utf8_lossy(&output);
    print!("{output}");
    eprint!(
        "{}",
        String::from_utf8_lossy(&err.join().expect("stderr observer"))
    );
    drop((desktop, job, worker_job));
    cleanup.expect("account and tree cleanup after process handles closed");
    permissions.expect("revoke fixture file boundary");
    assert_eq!(waited, WAIT_OBJECT_0, "real root timed out");
    assert_eq!(worker_waited, WAIT_OBJECT_0, "worker shutdown timed out");
    if pty {
        assert!(output.contains("PTY_TTY=true"));
        assert!(output.contains("PTY_INPUT=hello"));
        assert!(output.contains("PTY_SIZE=100x36"));
    }
    assert_eq!(exit_code, 0, "worker failed");
    println!(
        "PASS product worker pipe/PTY, Node child, protected file, current directory, account cleanup"
    );
}

#[cfg(not(windows))]
fn main() {
    panic!("Windows integration fixture");
}
