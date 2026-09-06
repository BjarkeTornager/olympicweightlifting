#!/usr/bin/env python3
"""Generate the checked-in Xcode project without third-party build dependencies."""
from pathlib import Path
import hashlib, json, plistlib
root = Path(__file__).resolve().parent
objects = {}
def uid(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def obj(name, value):
    key=uid(name); objects[key]=value; return key
def array(items): return '(' + ','.join(items) + ')'
def quoted(text): return json.dumps(str(text))
def configs(name, settings):
    ids=[]
    for mode in ['Debug','Release']:
        values={**settings,'SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else '', 'ENABLE_TESTABILITY':'YES' if mode=='Debug' else 'NO'}
        ids.append(obj(name+mode, 'isa = XCBuildConfiguration; name = '+mode+'; buildSettings = {'+''.join(f'{k} = {quoted(v)};' for k,v in values.items())+'};'))
    return obj(name+'configs','isa = XCConfigurationList; buildConfigurations = '+array(ids)+'; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
products=[]; groups=[]; targets=[]
project=uid('project')
base={'SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'18.0','SWIFT_VERSION':'6.0','TARGETED_DEVICE_FAMILY':'1,2','CLANG_ENABLE_MODULES':'YES','CODE_SIGN_STYLE':'Automatic','ENABLE_USER_SCRIPT_SANDBOXING':'YES','GENERATE_INFOPLIST_FILE':'YES','MARKETING_VERSION':'1.0','CURRENT_PROJECT_VERSION':'1','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','SUPPORTS_MACCATALYST':'NO'}
for target,folder,product_type,extension in [('LiftJournal','LiftJournal','com.apple.product-type.application','app'),('LiftJournalTests','LiftJournalTests','com.apple.product-type.bundle.unit-test','xctest'),('LiftJournalUITests','LiftJournalUITests','com.apple.product-type.bundle.ui-testing','xctest')]:
    refs=[]; builds=[]
    for path in sorted((root/folder).rglob('*.swift')):
        rel=path.relative_to(root)
        ref=obj(str(rel),'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = '+quoted(rel)+'; sourceTree = SOURCE_ROOT;')
        refs.append(ref); builds.append(obj(str(rel)+'build','isa = PBXBuildFile; fileRef = '+ref+';'))
    resource_build=[]
    if target=='LiftJournal':
        for path,kind in [('LiftJournal/Assets.xcassets','folder.assetcatalog'),('LiftJournal/PrivacyInfo.xcprivacy','text.xml')]:
            ref=obj(path,'isa = PBXFileReference; lastKnownFileType = '+kind+'; path = '+quoted(path)+'; sourceTree = SOURCE_ROOT;');refs.append(ref);resource_build.append(obj(path+'build','isa = PBXBuildFile; fileRef = '+ref+';'))
    groups.append(obj(target+'group','isa = PBXGroup; children = '+array(refs)+'; name = '+quoted(target)+'; sourceTree = "<group>";'))
    product=obj(target+'product',f'isa = PBXFileReference; explicitFileType = {"wrapper.application" if extension=="app" else "wrapper.cfbundle"}; includeInIndex = 0; path = {target}.{extension}; sourceTree = BUILT_PRODUCTS_DIR;');products.append(product)
    phases=[obj(target+'sources','isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = '+array(builds)+'; runOnlyForDeploymentPostprocessing = 0;'), obj(target+'resources','isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = '+array(resource_build)+'; runOnlyForDeploymentPostprocessing = 0;'),obj(target+'frameworks','isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')]
    settings={**base,'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'app.liftjournal.ios'+('.tests' if extension!='app' else '')+('.ui' if target.endswith('UITests') else '')}
    dependencies=[]
    if target=='LiftJournal': settings.update({'GENERATE_INFOPLIST_FILE':'NO','INFOPLIST_FILE':'LiftJournal/Info.plist','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME':'AccentColor','ENABLE_TESTABILITY':'YES'})
    else:
        proxy=obj(target+'proxy',f'isa = PBXContainerItemProxy; containerPortal = {project}; proxyType = 1; remoteGlobalIDString = {uid("LiftJournaltarget")}; remoteInfo = LiftJournal;')
        dependencies=[obj(target+'dependency',f'isa = PBXTargetDependency; target = {uid("LiftJournaltarget")}; targetProxy = {proxy};')]
        if target.endswith('UITests'): settings['TEST_TARGET_NAME']='LiftJournal'
        else: settings.update({'TEST_HOST':'$(BUILT_PRODUCTS_DIR)/LiftJournal.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/LiftJournal','BUNDLE_LOADER':'$(TEST_HOST)'})
    targets.append(obj(target+'target','isa = PBXNativeTarget; buildConfigurationList = '+configs(target,settings)+'; buildPhases = '+array(phases)+'; buildRules = (); dependencies = '+array(dependencies)+'; name = '+target+'; productName = '+target+'; productReference = '+product+'; productType = '+quoted(product_type)+';'))
product_group=obj('products','isa = PBXGroup; children = '+array(products)+'; name = Products; sourceTree = "<group>";')
main=obj('main','isa = PBXGroup; children = '+array(groups+[product_group])+'; sourceTree = "<group>";')
obj('project','isa = PBXProject; attributes = {LastUpgradeCheck = 2630; BuildIndependentTargetsInParallel = YES;}; buildConfigurationList = '+configs('project',{'CLANG_ENABLE_MODULES':'YES'})+'; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; knownRegions = (en,Base); mainGroup = '+main+'; productRefGroup = '+product_group+'; projectDirPath = ""; projectRoot = ""; targets = '+array(targets)+';')
project_dir=root/'LiftJournal.xcodeproj';project_dir.mkdir(exist_ok=True)
(project_dir/'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+''.join(k+' = {'+v+'};\n' for k,v in objects.items())+'}; rootObject = '+project+'; }\n')
def reference(name,ext): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid(name+"target")}" BuildableName="{name}.{ext}" BlueprintName="{name}" ReferencedContainer="container:LiftJournal.xcodeproj"/>'
scheme_dir=project_dir/'xcshareddata/xcschemes';scheme_dir.mkdir(parents=True,exist_ok=True)
(scheme_dir/'LiftJournal.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="2630" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference('LiftJournal','app')}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{reference('LiftJournalTests','xctest')}</TestableReference><TestableReference skipped="NO">{reference('LiftJournalUITests','xctest')}</TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference('LiftJournal','app')}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference('LiftJournal','app')}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
print('Generated LiftJournal.xcodeproj')
