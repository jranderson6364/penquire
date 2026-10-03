Pod::Spec.new do |s|
  s.name           = 'PencilCanvas'
  s.version        = '0.1.0'
  s.summary        = 'PencilKit canvas for Penquire'
  s.description    = 'Wraps PKCanvasView: Apple Pencil ink, stroke export, labeled page images.'
  s.author         = 'Penquire'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PencilKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
