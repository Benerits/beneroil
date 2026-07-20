#!/usr/bin/env bash
# BenelOil Unity — Core (saf C#, UnityEngine'siz) katmanını hızlı derleme kontrolü.
# UnityEngine'e dokunan katmanlar (World/UI/Net MonoBehaviour'ları) yalnızca Unity
# batch-mode'da derlenir; bu script motor-bağımsız Core/Sim mantığını saniyeler içinde doğrular.
set -euo pipefail
DOTNET="/Applications/Unity/Hub/Editor/6000.5.4f1/Unity.app/Contents/Resources/Scripting/DotNetSdk/dotnet"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
cat > "$WORK/corecheck.csproj" <<EOF
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <LangVersion>9</LangVersion>
    <NoWarn>CS0169;CS0414;CS0649</NoWarn>
    <OutputType>Library</OutputType>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="$HERE/BenelOil/Assets/Scripts/Core/*.cs" />
    <Compile Include="$HERE/BenelOil/Assets/Scripts/Sim/*.cs" />
  </ItemGroup>
</Project>
EOF
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
"$DOTNET" build "$WORK/corecheck.csproj" -v q -nologo 2>&1 | grep -iE "error|Hata|Build succeeded|Oluşturma başarılı" || true
rm -rf "$WORK"
