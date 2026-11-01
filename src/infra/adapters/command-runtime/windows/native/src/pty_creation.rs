use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::null;
use std::sync::Mutex;

use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Console::{
    COORD, ClosePseudoConsole, CreatePseudoConsole, HPCON, ResizePseudoConsole,
};
use windows_sys::Win32::System::Threading::{
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, EXTENDED_STARTUPINFO_PRESENT,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, PROCESS_INFORMATION,
    STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

use crate::error::{NativeError, NativeResult};
use crate::fault_injection::NativeFaultInjection;
use crate::handle::OwnedHandle;
use crate::launch_spec::NativeLaunchSpec;
use crate::process_creation::{AttributeList, create_job, create_pipe};

pub(crate) struct SharedPseudoConsole {
    value: Mutex<Option<HPCON>>,
}

impl SharedPseudoConsole {
    fn new(value: HPCON) -> NativeResult<Self> {
        if value == 0 {
            return Err(NativeError::contract(
                "pseudoconsole_create",
                "CreatePseudoConsole returned an empty handle",
            ));
        }
        Ok(Self {
            value: Mutex::new(Some(value)),
        })
    }

    pub(crate) fn resize(&self, columns: u16, rows: u16) -> NativeResult<()> {
        let value = self.value.lock().map_err(|_| {
            NativeError::contract("pseudoconsole_resize", "pseudoconsole lock was poisoned")
        })?;
        let pseudoconsole = value.as_ref().copied().ok_or_else(|| {
            NativeError::contract("pseudoconsole_resize", "pseudoconsole is closed")
        })?;
        // SAFETY: pseudoconsole 在锁内保活；尺寸已由调用方限制为 Win32 COORD 的正数范围。
        let result = unsafe {
            ResizePseudoConsole(
                pseudoconsole,
                COORD {
                    X: columns as i16,
                    Y: rows as i16,
                },
            )
        };
        if result < 0 {
            return Err(NativeError::contract(
                "pseudoconsole_resize",
                format!("HRESULT={result}"),
            ));
        }
        Ok(())
    }

    pub(crate) fn close(&self) -> NativeResult<()> {
        let pseudoconsole = self
            .value
            .lock()
            .map_err(|_| {
                NativeError::contract("pseudoconsole_close", "pseudoconsole lock was poisoned")
            })?
            .take();
        if let Some(pseudoconsole) = pseudoconsole {
            // ClosePseudoConsole 在 Win10/旧版 Win11 可能等待 client 退出；调用方必须先证明
            // command Job 已空，并让独立 output observer 持续排空终端输出。
            // SAFETY: pseudoconsole 来自 CreatePseudoConsole，且只在本处取得一次关闭所有权。
            unsafe { ClosePseudoConsole(pseudoconsole) };
        }
        Ok(())
    }
}

impl Drop for SharedPseudoConsole {
    fn drop(&mut self) {
        let value = match self.value.get_mut() {
            Ok(value) => value,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(pseudoconsole) = value.take() {
            // SAFETY: Drop 只接管仍未被显式 close 的 CreatePseudoConsole 返回值。
            unsafe { ClosePseudoConsole(pseudoconsole) };
        }
    }
}

pub(crate) struct CreatedWindowsPtyResources {
    // 异常返回时 Rust 按字段声明顺序 drop。必须先用 Job 结束 client，再关闭 parent
    // output/input 端，最后关闭 HPCON；否则旧版 Windows 的 ClosePseudoConsole 可能
    // 等待仍存活或无人排空的 client，令创建失败路径永久卡住。
    pub(crate) job: OwnedHandle,
    pub(crate) process: OwnedHandle,
    pub(crate) thread: OwnedHandle,
    pub(crate) output_reader: OwnedHandle,
    pub(crate) input_writer: OwnedHandle,
    pub(crate) pseudoconsole: SharedPseudoConsole,
    pub(crate) conpty_input_reader: OwnedHandle,
    pub(crate) conpty_output_writer: OwnedHandle,
}

pub(crate) fn validate_pty_size(columns: u16, rows: u16) -> NativeResult<()> {
    if columns == 0 || columns > i16::MAX as u16 || rows == 0 || rows > i16::MAX as u16 {
        return Err(NativeError::contract(
            "pseudoconsole_size",
            format!("columns={columns} rows={rows}; expected 1..={}", i16::MAX),
        ));
    }
    Ok(())
}

pub(crate) fn create_windows_pty_resources(
    mut spec: NativeLaunchSpec,
    columns: u16,
    rows: u16,
    fault_injection: &NativeFaultInjection,
) -> NativeResult<CreatedWindowsPtyResources> {
    validate_pty_size(columns, rows)?;
    let job = create_job()?;
    fault_injection.check("job_after_create")?;

    // ConPTY 本身使用同步 pipe，不把这些端点继承给 client。client 只通过
    // PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE 连接，避免继承 utility 的其他句柄。
    let input_pipe = create_pipe(false)?;
    let output_pipe = create_pipe(false)?;
    fault_injection.check("pipe_after_create")?;

    let mut raw_pseudoconsole = 0;
    // SAFETY: 两个同步 pipe 端点在调用期间有效，输出地址指向本地 HPCON；成功值立即
    // 移交 SharedPseudoConsole。flags=0 禁止继承 cursor 查询协议，避免额外握手与卡死面。
    let create_result = unsafe {
        CreatePseudoConsole(
            COORD {
                X: columns as i16,
                Y: rows as i16,
            },
            input_pipe.reader.as_raw(),
            output_pipe.writer.as_raw(),
            0,
            &mut raw_pseudoconsole,
        )
    };
    if create_result < 0 {
        return Err(NativeError::contract(
            "pseudoconsole_create",
            format!("HRESULT={create_result}"),
        ));
    }
    let pseudoconsole = SharedPseudoConsole::new(raw_pseudoconsole)?;
    fault_injection.check("pseudoconsole_after_create")?;

    let job_handles: [HANDLE; 1] = [job.as_raw()];
    let mut attributes = AttributeList::create(2)?;
    attributes.update_handles(
        PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
        &job_handles,
        "attribute_job_list",
    )?;
    attributes.update_pseudoconsole(
        PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
        raw_pseudoconsole,
        "attribute_pseudoconsole",
    )?;
    fault_injection.check("attribute_after_initialize")?;

    // SAFETY: STARTUPINFOEXW 是 Win32 POD。ConPTY client 的 stdio 由伪终端接管，三个
    // INVALID_HANDLE_VALUE 明确避免它碰巧继承 utility 或 SSH 的标准句柄。
    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
    startup.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
    startup.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
    startup.lpAttributeList = attributes.as_mut_ptr();

    // SAFETY: PROCESS_INFORMATION 是 Win32 输出 POD，CreateProcessW 成功时完整写入。
    let mut process_information: PROCESS_INFORMATION = unsafe { zeroed() };
    let creation_flags =
        CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT;
    // SAFETY: spec 的 UTF-16 buffer、attribute list、Job 和 HPCON 在调用期间全部保活；
    // bInheritHandles=0，client 的 Job 与伪终端归属在同一次 CreateProcessW 中建立。
    if unsafe {
        CreateProcessW(
            spec.executable_path.as_ptr(),
            spec.command_line.as_mut_ptr(),
            null(),
            null(),
            0,
            creation_flags,
            spec.environment.as_ptr().cast::<c_void>(),
            spec.cwd.as_ptr(),
            &startup.StartupInfo,
            &mut process_information,
        )
    } == 0
    {
        return Err(NativeError::last_win32("pty_process_create"));
    }

    let resources = CreatedWindowsPtyResources {
        job,
        process: OwnedHandle::from_raw(process_information.hProcess, "pty_process_handle")?,
        thread: OwnedHandle::from_raw(process_information.hThread, "pty_thread_handle")?,
        output_reader: output_pipe.reader,
        input_writer: input_pipe.writer,
        pseudoconsole,
        conpty_input_reader: input_pipe.reader,
        conpty_output_writer: output_pipe.writer,
    };
    // 先形成字段顺序固定的 owner，再注入 post-create 故障。失败时 job 字段最先 drop，
    // KILL_ON_JOB_CLOSE 会先结束 suspended client，之后 ClosePseudoConsole 才不会在
    // Windows 10/旧版 Windows 11 上等待仍存活的 client。
    fault_injection.check("process_after_create")?;
    Ok(resources)
}
