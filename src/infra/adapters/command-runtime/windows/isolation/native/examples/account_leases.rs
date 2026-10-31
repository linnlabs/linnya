//! 在 Windows 普通用户会话运行；服务由单独的提升安装步骤建立。本探针不输出账户密码。
#[cfg(windows)]
fn main() {
    use linnya_windows_command_isolation::AccountLease;
    let mode = std::env::args().nth(1).unwrap_or_else(|| "parallel".into());
    if mode == "hold" {
        let lease = AccountLease::acquire().expect("acquire account");
        println!(
            "ACCOUNT={} SID={} JOB={}",
            lease.account_name, lease.account_sid, lease.job_name
        );
        std::thread::sleep(std::time::Duration::from_secs(120));
        lease.release().expect("release account");
        return;
    }
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let threads: Vec<_> = (0..3)
        .map(|index| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let lease = AccountLease::acquire().expect("acquire independent account");
                let identity = (lease.account_name.clone(), lease.account_sid.clone());
                assert!(
                    srt_win::sam::is_member_of(&lease.group_sid, &lease.account_sid)
                        .expect("account group")
                );
                barrier.wait();
                if index == 0 {
                    drop(lease);
                } else {
                    lease.release().expect("release after tree cleanup");
                }
                identity
            })
        })
        .collect();
    let identities: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().expect("lease thread"))
        .collect();
    for (index, identity) in identities.iter().enumerate() {
        assert!(
            !identities[..index]
                .iter()
                .any(|earlier| earlier.0 == identity.0 || earlier.1 == identity.1)
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while srt_win::sid::lookup_account_sid(&identity.0).is_ok() {
            assert!(
                std::time::Instant::now() < deadline,
                "account was not removed: {}",
                identity.0
            );
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    println!(
        "PASS parallel accounts, distinct identities, explicit release and connection-drop cleanup"
    );
}

#[cfg(not(windows))]
fn main() {
    panic!("Windows integration fixture");
}
