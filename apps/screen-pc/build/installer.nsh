; Titan Screen: входящие подключения на порт 8788 — по нему телефон с Titan HUB находит
; компьютер в локальной сети и передаёт ему код привязки. Без правила Windows спросит
; про брандмауэр при первом запуске, а в сети «Общедоступная» тихо заблокирует.
!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Titan Screen"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Titan Screen" dir=in action=allow protocol=TCP localport=8788 profile=any'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Titan Screen"'
!macroend
