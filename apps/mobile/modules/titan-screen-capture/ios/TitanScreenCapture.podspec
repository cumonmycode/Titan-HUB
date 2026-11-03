Pod::Spec.new do |s|
  s.name           = 'TitanScreenCapture'
  s.version        = '1.0.0'
  s.summary        = 'Показ экрана в Titan HUB: идёт ли запись, FaceTime, AirPlay или дублирование'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'Titan'
  s.homepage       = 'https://titanpos.ru'
  s.platforms      = { :ios => '17.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
