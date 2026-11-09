import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { main } from "./check-schedule.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretPath = path.join(root, "data/check-keys.local").replace(/'/g, "''");
// DPAPI decrypts only for the Windows account that configured the task. The pipe
// stays in memory; never forward its output to logs or change execution policies.
const command = `$ErrorActionPreference='Stop'; $map=Import-Clixml -LiteralPath '${secretPath}'; $plain=@{}; foreach($name in $map.Keys){ $cred=New-Object System.Management.Automation.PSCredential('scheduled',$map[$name]); $plain[$name]=$cred.GetNetworkCredential().Password }; $plain | ConvertTo-Json -Compress`;
const result = spawnSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
const previous = new Map();
try {
  if (result.status !== 0) throw new Error("credentials");
  const secrets = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  result.stdout = "";
  for (const [name, value] of Object.entries(secrets)) {
    if (!/^[A-Z][A-Z0-9_]*_BASIC_KEY$/.test(name) || typeof value !== "string" || value.length < 12) throw new Error("credentials");
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  await main();
} catch {
  console.error("自动检测未启动：请核对本机加密凭据、名单和运行锁。必须使用配置时的 Windows 账户。");
  process.exitCode = 1;
} finally {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
