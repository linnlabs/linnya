use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HANDLE, HANDLE_FLAG_INHERIT, SetHandleInformation};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::System::Console::HPCON;
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, SetInformationJobObject,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
    DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, InitializeProcThreadAttributeList,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    UpdateProcThreadAttribute,
};

use crate::error::{NativeError, NativeResult};
use crate::fault_injection::NativeFaultInjection;
use crate::handle::OwnedHandle;
use crate::launch_spec::NativeLaunchSpec;

pub(crate) struct AttributeList {
    storage: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}

impl AttributeList {
    pub(crate) fn create(attribute_count: u32) -> NativeResult<Self> {
        let mut required_bytes = 0usize;
        // SAFETY: 首次传空指针是 Win32 规定的容量查询方式，required_bytes 是有效输出地址。
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), attribute_count, 0, &mut required_bytes);
        }
        if required_bytes == 0 {
            return Err(NativeError::last_win32("attribute_list_size"));
        }
        let word_count = required_bytes.div_ceil(size_of::<usize>());
        let mut storage = vec![0usize; word_count];
        let pointer = storage.as_mut_ptr().cast::<c_void>();
        // SAFETY: Vec<usize> 提供 attribute list 所需对齐，分配字节数不少于查询结果；
        // storage 会随 AttributeList 一直存活到 DeleteProcThreadAttributeList。
        if unsafe {
            InitializeProcThreadAttributeList(pointer, attribute_count, 0, &mut required_bytes)
        } == 0
        {
            return Err(NativeError::last_win32("attribute_list_initialize"));
        }
        Ok(Self { storage, pointer })
    }

    pub(crate) fn update_handles(
        &mut self,
        attribute: usize,
        handles: &[HANDLE],
        stage: &'static str,
    ) -> NativeResult<()> {
        // SAFETY: self.pointer 指向已初始化且仍由 storage 承载的 attribute list；handles
        // 在本轮更新及随后的 CreateProcessW 期间保持存活，长度按切片真实字节数传入。
        if unsafe {
            UpdateProcThreadAttribute(
                self.pointer,
                0,
                attribute,
                handles.as_ptr().cast::<c_void>(),
                std::mem::size_of_val(handles),
                null_mut(),
                null(),
            )
        } == 0
        {
            return Err(NativeError::last_win32(stage));
        }
        Ok(())
    }

    pub(crate) fn update_pseudoconsole(
        &mut self,
        attribute: usize,
        pseudoconsole: HPCON,
        stage: &'static str,
    ) -> NativeResult<()> {
        // PSEUDOCONSOLE 属性和普通结构体属性不同：Win32 要求 lpValue 直接承载
        // HPCON 值，而不是指向 HPCON 变量的地址。这个专用入口避免再次混淆两种 ABI。
        // SAFETY: self.pointer 指向仍由 storage 承载的 attribute list；pseudoconsole
        // 在后续 CreateProcessW 返回前由调用方保活。
        if unsafe {
            UpdateProcThreadAttribute(
                self.pointer,
                0,
                attribute,
                pseudoconsole as *mut c_void,
                size_of::<HPCON>(),
                null_mut(),
                null(),
            )
        } == 0
        {
            return Err(NativeError::last_win32(stage));
        }
        Ok(())
    }

    pub(crate) fn as_mut_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.pointer
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            // SAFETY: pointer 只在初始化成功后保存，且只由本 Drop 删除一次；storage 此时仍存活。
            unsafe {
                DeleteProcThreadAttributeList(self.pointer);
            }
            self.pointer = null_mut();
        }
        self.storage.clear();
    }
}

pub(crate) struct PipePair {
    pub(crate) reader: OwnedHandle,
    pub(crate) writer: OwnedHandle,
}

pub(crate) fn create_pipe(inheritable: bool) -> NativeResult<PipePair> {
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: u32::from(inheritable) as i32,
    };
    let mut reader = null_mut();
    let mut writer = null_mut();
    // SAFETY: 两个输出地址和 SECURITY_ATTRIBUTES 在调用期间有效；成功返回的两个句柄立即移交 OwnedHandle。
    if unsafe { CreatePipe(&mut reader, &mut writer, &security, 0) } == 0 {
        return Err(NativeError::last_win32("pipe_create"));
    }
    let reader = OwnedHandle::from_raw(reader, "pipe_reader")?;
    let writer = OwnedHandle::from_raw(writer, "pipe_writer")?;
    Ok(PipePair { reader, writer })
}

fn create_inheritable_pipe(parent_reads: bool) -> NativeResult<PipePair> {
    let pair = create_pipe(true)?;
    let parent_handle = if parent_reads {
        pair.reader.as_raw()
    } else {
        pair.writer.as_raw()
    };
    // SAFETY: parent_handle 由上方 OwnedHandle 持有并在调用期间有效，只清除继承标志，不转移所有权。
    if unsafe { SetHandleInformation(parent_handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
        return Err(NativeError::last_win32("pipe_parent_inheritance"));
    }
    Ok(pair)
}

pub(crate) fn create_job() -> NativeResult<OwnedHandle> {
    // SAFETY: 传入空安全描述符和空名称是匿名 Job 的合法 Win32 调用，成功句柄立即移交 OwnedHandle。
    let job = OwnedHandle::from_raw(unsafe { CreateJobObjectW(null(), null()) }, "job_create")?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: job 由 OwnedHandle 持有；limits 指针和精确结构长度在同步调用期间有效。
    if unsafe {
        SetInformationJobObject(
            job.as_raw(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err(NativeError::last_win32("job_limit"));
    }
    Ok(job)
}

pub(crate) struct CreatedWindowsProcessResources {
    pub(crate) job: OwnedHandle,
    pub(crate) process: OwnedHandle,
    pub(crate) thread: OwnedHandle,
    pub(crate) stdin_writer: OwnedHandle,
    pub(crate) stdout_reader: OwnedHandle,
    pub(crate) stderr_reader: OwnedHandle,
}

pub(crate) fn create_windows_process_resources(
    mut spec: NativeLaunchSpec,
    fault_injection: &NativeFaultInjection,
) -> NativeResult<CreatedWindowsProcessResources> {
    let job = create_job()?;
    fault_injection.check("job_after_create")?;
    let stdin_pipe = create_inheritable_pipe(false)?;
    let stdout_pipe = create_inheritable_pipe(true)?;
    let stderr_pipe = create_inheritable_pipe(true)?;
    fault_injection.check("pipe_after_create")?;

    let child_handles = [
        stdin_pipe.reader.as_raw(),
        stdout_pipe.writer.as_raw(),
        stderr_pipe.writer.as_raw(),
    ];
    let job_handles = [job.as_raw()];
    let mut attributes = AttributeList::create(2)?;
    attributes.update_handles(
        PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
        &job_handles,
        "attribute_job_list",
    )?;
    attributes.update_handles(
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
        &child_handles,
        "attribute_handle_list",
    )?;
    fault_injection.check("attribute_after_initialize")?;

    // SAFETY: STARTUPINFOEXW 是 Win32 POD，零初始化后再设置 cb、stdio 和 attribute list 字段。
    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = child_handles[0];
    startup.StartupInfo.hStdOutput = child_handles[1];
    startup.StartupInfo.hStdError = child_handles[2];
    startup.lpAttributeList = attributes.pointer;

    // SAFETY: PROCESS_INFORMATION 是 Win32 输出 POD，CreateProcessW 会在成功时完整写入句柄和 ID。
    let mut process_information: PROCESS_INFORMATION = unsafe { zeroed() };
    let creation_flags = CREATE_SUSPENDED
        | CREATE_UNICODE_ENVIRONMENT
        | EXTENDED_STARTUPINFO_PRESENT
        | CREATE_NO_WINDOW;
    // SAFETY: spec 的 NUL 结尾 UTF-16 buffers、可变 command line、环境块和 cwd 在调用期间存活；
    // attribute storage、Job 及三个 child pipe 端也持续有效。Handle List 将继承范围限制为这三个端点。
    if unsafe {
        CreateProcessW(
            spec.executable_path.as_ptr(),
            spec.command_line.as_mut_ptr(),
            null(),
            null(),
            1,
            creation_flags,
            spec.environment.as_ptr().cast::<c_void>(),
            spec.cwd.as_ptr(),
            &startup.StartupInfo,
            &mut process_information,
        )
    } == 0
    {
        return Err(NativeError::last_win32("process_create"));
    }

    let process = OwnedHandle::from_raw(process_information.hProcess, "process_handle")?;
    let thread = OwnedHandle::from_raw(process_information.hThread, "thread_handle")?;
    // CreateProcessW 已复制 Handle List 中的 child 端；本 utility 只保留 parent 端。
    drop(stdin_pipe.reader);
    drop(stdout_pipe.writer);
    drop(stderr_pipe.writer);
    fault_injection.check("process_after_create")?;

    Ok(CreatedWindowsProcessResources {
        job,
        process,
        thread,
        stdin_writer: stdin_pipe.writer,
        stdout_reader: stdout_pipe.reader,
        stderr_reader: stderr_pipe.reader,
    })
}
