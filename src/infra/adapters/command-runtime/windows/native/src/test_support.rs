use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};

use napi_derive::napi;
use windows_sys::Win32::Foundation::{
    ERROR_SUCCESS, FILETIME, GetLastError, HANDLE, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW};
use windows_sys::Win32::System::Threading::{
    CREATE_BREAKAWAY_FROM_JOB, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateEventW,
    CreateProcessW, GetCurrentProcess, GetProcessId, GetProcessTimes, PROCESS_INFORMATION,
    STARTUPINFOW, SetEvent, TerminateProcess, WaitForSingleObject,
};

use crate::error::{NativeError, NativeResult};
use crate::handle::{OwnedHandle, SharedHandle};
use crate::launch_spec::WindowsOwnedPipeLaunchInput;

const TEST_TERMINATION_EXIT_CODE: u32 = 1;

#[napi(object)]
pub struct WindowsProcessIdentityForTest {
    pub process_id: u32,
    pub creation_file_time: String,
}

pub(crate) fn read_process_identity_for_test(
    process: HANDLE,
) -> NativeResult<WindowsProcessIdentityForTest> {
    // SAFETY: 调用方在 SharedHandle 锁内传入并保活真实进程句柄；GetProcessId 只读取句柄身份。
    let process_id = unsafe { GetProcessId(process) };
    if process_id == 0 {
        return Err(NativeError::last_win32("test_process_id"));
    }
    let mut creation_time = FILETIME::default();
    let mut exit_time = FILETIME::default();
    let mut kernel_time = FILETIME::default();
    let mut user_time = FILETIME::default();
    // SAFETY: process 在调用期间有效，四个 FILETIME 均为独立且可写的输出地址。
    if unsafe {
        GetProcessTimes(
            process,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        )
    } == 0
    {
        return Err(NativeError::last_win32("test_process_time"));
    }
    let creation_file_time =
        ((creation_time.dwHighDateTime as u64) << 32) | creation_time.dwLowDateTime as u64;
    Ok(WindowsProcessIdentityForTest {
        process_id,
        creation_file_time: creation_file_time.to_string(),
    })
}

#[napi]
pub struct WindowsHandleInheritanceSentinelForTest {
    handle: SharedHandle,
}

#[napi]
impl WindowsHandleInheritanceSentinelForTest {
    #[napi]
    pub fn raw_handle(&self) -> napi::Result<String> {
        let handle = self.handle.lock("test_sentinel_raw")?;
        let handle = handle
            .as_ref()
            .ok_or_else(|| NativeError::contract("test_sentinel_raw", "sentinel is closed"))?;
        Ok((handle.as_raw() as usize).to_string())
    }

    #[napi]
    pub fn was_signaled(&self) -> napi::Result<bool> {
        let handle = self.handle.lock("test_sentinel_wait")?;
        let handle = handle
            .as_ref()
            .ok_or_else(|| NativeError::contract("test_sentinel_wait", "sentinel is closed"))?;
        // SAFETY: SharedHandle 锁保活 event 句柄，零超时等待只读取其 signaled 状态。
        match unsafe { WaitForSingleObject(handle.as_raw(), 0) } {
            WAIT_OBJECT_0 => Ok(true),
            WAIT_TIMEOUT => Ok(false),
            WAIT_FAILED => Err(NativeError::last_win32("test_sentinel_wait").into()),
            result => Err(NativeError::contract(
                "test_sentinel_wait",
                format!("unexpected wait result: {result}"),
            )
            .into()),
        }
    }

    #[napi]
    pub fn close(&self) -> napi::Result<()> {
        self.handle.close("test_sentinel_close").map_err(Into::into)
    }
}

#[napi]
pub fn create_inheritable_handle_sentinel_for_test()
-> napi::Result<WindowsHandleInheritanceSentinelForTest> {
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let event = OwnedHandle::from_raw(
        // SAFETY: SECURITY_ATTRIBUTES 在同步调用期间有效；匿名 manual-reset event 的成功句柄立即移交 OwnedHandle。
        unsafe { CreateEventW(&security, 1, 0, null()) },
        "test_sentinel_create",
    )?;
    Ok(WindowsHandleInheritanceSentinelForTest {
        handle: SharedHandle::new(event),
    })
}

#[napi]
pub fn signal_handle_for_test(raw_handle: String) -> napi::Result<bool> {
    let raw = raw_handle
        .parse::<usize>()
        .map_err(|error| napi::Error::from_reason(format!("invalid test handle: {error}")))?;
    // SAFETY: 该接口只在隔离的继承测试 child 中使用由 parent 明确传入的 event HANDLE；不取得所有权。
    if unsafe { SetEvent(raw as HANDLE) } != 0 {
        return Ok(true);
    }
    // SAFETY: 紧接失败的 SetEvent 读取线程本地 Win32 错误，没有其他 Win32 调用插入。
    let error = unsafe { GetLastError() };
    if error == ERROR_SUCCESS {
        return Err(napi::Error::from_reason(
            "SetEvent failed without a Win32 error",
        ));
    }
    Ok(false)
}

#[napi]
pub struct WindowsOuterJobMembershipForTest {
    job: SharedHandle,
}

#[napi]
impl WindowsOuterJobMembershipForTest {
    #[napi]
    pub fn close(&self) -> napi::Result<()> {
        self.job.close("test_outer_job_close").map_err(Into::into)
    }
}

#[napi]
pub fn join_current_process_to_outer_job_for_test() -> napi::Result<WindowsOuterJobMembershipForTest>
{
    let job = OwnedHandle::from_raw(
        // SAFETY: 空安全描述符和名称创建匿名测试 Job，成功句柄立即移交 OwnedHandle。
        unsafe { CreateJobObjectW(null(), null()) },
        "test_outer_job",
    )?;
    // SAFETY: job 由 OwnedHandle 保活；GetCurrentProcess 返回无需关闭的永久伪句柄。
    if unsafe { AssignProcessToJobObject(job.as_raw(), GetCurrentProcess()) } == 0 {
        return Err(NativeError::last_win32("test_outer_job_assign").into());
    }
    Ok(WindowsOuterJobMembershipForTest {
        job: SharedHandle::new(job),
    })
}

#[napi]
pub fn attempt_breakaway_process_for_test(input: WindowsOwnedPipeLaunchInput) -> napi::Result<u32> {
    let mut spec = input.into_native().map_err(napi::Error::from)?;
    let startup = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        // SAFETY: STARTUPINFOW 是 Win32 POD，其余字段为此无窗口探针所需的合法零值。
        ..unsafe { zeroed() }
    };
    // SAFETY: PROCESS_INFORMATION 是 Win32 输出 POD，CreateProcessW 成功时完整写入。
    let mut process_information: PROCESS_INFORMATION = unsafe { zeroed() };
    // SAFETY: spec 的 NUL 结尾 UTF-16 buffers、可变 command line、环境块和 cwd 在同步调用期间保持存活；
    // 不继承 handle，输出结构有效。child 以 suspended 创建，成功路径会在下方先终止再关闭。
    let created = unsafe {
        CreateProcessW(
            spec.executable_path.as_ptr(),
            spec.command_line.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_BREAKAWAY_FROM_JOB | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
            spec.environment.as_ptr().cast::<c_void>(),
            spec.cwd.as_ptr(),
            &startup,
            &mut process_information,
        )
    };
    if created == 0 {
        // SAFETY: 紧接失败的 CreateProcessW 获取线程本地错误码。
        return Ok(unsafe { GetLastError() });
    }

    let process = OwnedHandle::from_raw(process_information.hProcess, "test_breakaway_process")?;
    let thread = OwnedHandle::from_raw(process_information.hThread, "test_breakaway_thread")?;
    let mut cleanup_failures = Vec::<String>::new();
    // SAFETY: process 由 OwnedHandle 保活且仍处于 suspended；调用只终止，不转移句柄所有权。
    if unsafe { TerminateProcess(process.as_raw(), TEST_TERMINATION_EXIT_CODE) } == 0 {
        cleanup_failures.push(NativeError::last_win32("test_breakaway_terminate").to_string());
    }
    // SAFETY: process 在等待期间仍由 OwnedHandle 保活，五秒等待不转移所有权。
    if unsafe { WaitForSingleObject(process.as_raw(), 5_000) } != WAIT_OBJECT_0 {
        cleanup_failures.push("test_breakaway_wait did not signal".to_owned());
    }
    for result in [
        thread.close("test_breakaway_thread_close"),
        process.close("test_breakaway_process_close"),
    ] {
        if let Err(error) = result {
            cleanup_failures.push(error.to_string());
        }
    }
    if cleanup_failures.is_empty() {
        Ok(0)
    } else {
        Err(napi::Error::from_reason(cleanup_failures.join("; ")))
    }
}
