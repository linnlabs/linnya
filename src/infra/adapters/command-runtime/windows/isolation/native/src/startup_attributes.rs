use crate::{IsolationError, IsolationResult};
use std::mem::size_of;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Threading::{
    DeleteProcThreadAttributeList, InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
    UpdateProcThreadAttribute,
};

pub(crate) struct StartupAttributes {
    _storage: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}

impl StartupAttributes {
    pub(crate) fn new(count: u32) -> IsolationResult<Self> {
        let mut bytes = 0;
        // SAFETY: 空缓冲是 Win32 规定的容量查询，bytes 为有效输出地址。
        unsafe {
            let _ = InitializeProcThreadAttributeList(None, count, None, &mut bytes);
        }
        if bytes == 0 {
            return Err(IsolationError::new(
                "worker_attributes_size",
                "attribute list size unavailable",
            ));
        }
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        let pointer = LPPROC_THREAD_ATTRIBUTE_LIST(storage.as_mut_ptr().cast());
        // SAFETY: usize buffer 对齐且容量不小于系统要求；随对象一直保活到 Delete。
        unsafe { InitializeProcThreadAttributeList(Some(pointer), count, None, &mut bytes) }
            .map_err(|error| {
                IsolationError::new("worker_attributes_initialize", error.to_string())
            })?;
        Ok(Self {
            _storage: storage,
            pointer,
        })
    }

    pub(crate) fn handles(&mut self, kind: usize, handles: &[HANDLE]) -> IsolationResult<()> {
        // SAFETY: pointer 是已初始化列表；调用者保活 handles 直到 CreateProcessAsUserW 返回。
        unsafe {
            UpdateProcThreadAttribute(
                self.pointer,
                0,
                kind,
                Some(handles.as_ptr().cast()),
                std::mem::size_of_val(handles),
                None,
                None,
            )
        }
        .map_err(|error| IsolationError::new("worker_attributes_handles", error.to_string()))
    }

    pub(crate) fn pointer(&self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.pointer
    }

    pub(crate) fn pseudoconsole(
        &mut self,
        console: windows::Win32::System::Console::HPCON,
    ) -> IsolationResult<()> {
        // SAFETY: PSEUDOCONSOLE 属性直接传 HPCON 值而不是 &HPCON；调用方保活它到 CreateProcess 返回。
        unsafe {
            UpdateProcThreadAttribute(
                self.pointer,
                0,
                windows::Win32::System::Threading::PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                Some(console.0 as *const _),
                size_of::<windows::Win32::System::Console::HPCON>(),
                None,
                None,
            )
        }
        .map_err(|error| IsolationError::new("worker_pseudoconsole_attribute", error.to_string()))
    }
}

impl Drop for StartupAttributes {
    fn drop(&mut self) {
        // SAFETY: 只删除一次已初始化的列表，storage 在 Drop 返回后才释放。
        unsafe {
            DeleteProcThreadAttributeList(self.pointer);
        }
    }
}
