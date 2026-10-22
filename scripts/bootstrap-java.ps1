$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
Push-Location $rootPath
try {
    $sdkLock = Get-Content deploy/java-sdk.lock.json -Raw | ConvertFrom-Json
    foreach ($name in @('core', 'runtime')) {
        $sdk = $sdkLock.$name
        $checkout = Join-Path $rootPath ".cache/upstream/agent-$name-java"
        if (-not (Test-Path -LiteralPath (Join-Path $checkout '.git'))) {
            & git clone --no-checkout $sdk.repository $checkout
            if ($LASTEXITCODE -ne 0) { throw "Cannot clone $name" }
        }
        $trackedChanges = & git -C $checkout status --porcelain --untracked-files=no
        if ($trackedChanges) { throw "Upstream checkout has local changes: $name" }
        & git -C $checkout fetch --depth 1 origin $sdk.commit
        if ($LASTEXITCODE -ne 0) { throw "Cannot fetch pinned $name" }
        & git -C $checkout checkout --detach $sdk.commit
        if ($LASTEXITCODE -ne 0) { throw "Cannot select pinned $name" }
    }
    & mvn -B -f .cache/upstream/agent-core-java/core/pom.xml '-Dmaven.test.skip=true' install
    if ($LASTEXITCODE -ne 0) { throw 'Core dependency build failed' }
    & mvn -B -f .cache/upstream/agent-runtime-java/pom.xml -pl service/agent-service-app,service/agent-service-adapters/agent-service-adapters-agentcore -am '-Dmaven.test.skip=true' install
    if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency build failed' }
    & mvn -B -f java/runtime-bridge/pom.xml verify
    if ($LASTEXITCODE -ne 0) { throw 'Bridge verification failed' }
} finally { Pop-Location }
