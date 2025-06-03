
import { spawn } from 'node:child_process';

export default function runMcpServerAndThen(command, runArgsJSON, runDir, runEnvJSON, startedFunc, exitFunc) {
  if (typeof command !== 'string') {
    throw new Error('MCP_SERVER_RUN_COMMAND must be a shell command');
  }
  let runArgs;
  try {
    runArgs = JSON.parse(runArgsJSON);
    if (!Array.isArray(runArgs)) {
      throw new Error('parsed into wrong type');
    }
  } catch (err) {
    throw new Error(`MCP_SERVER_RUN_ARGS_JSON must be a valid JSON array, ${err}`);
  }
  if (typeof runDir !== 'string') {
    throw new Error('MCP_SERVER_RUN_DIR must be a directory path');
  }
  let runEnv;
  try {
    runEnv = JSON.parse(runEnvJSON);
    if (typeof runEnv !== 'object' || Array.isArray(runEnv) || runEnv == null) {
      throw new Error('parsed into wrong type');
    }
  } catch (err) {
    throw new Error(`MCP_SERVER_RUN_ENV_JSON must be a valid JSON object, ${err}`);
  }

  const mcpServerProcess = spawn(
    command,
    runArgs,
    {
      cwd: runDir,
      env: {
        ...process.env,
        ...runEnv
      }
    }
  );

  // Started func is only called once, after the MCP Server sub-process starts-up
  let startedFuncCalled = false;

  mcpServerProcess.on('error', (err) => {
    console.log(`MCP Server process error ${err}`);
    exitFunc(1);
  });
  mcpServerProcess.stdout.on('data', (data) => {
    console.log(`mcp-server: ${data}`.trim());
    if (!startedFuncCalled) {
      startedFuncCalled = true;
      try {
        startedFunc();
      } catch (err) {
        console.log(`MCP Server process failed to start, ${err}`);
        exitFunc(1);
      }
    }
  });
  mcpServerProcess.stderr.on('data', (data) => {
    console.error(`mcp-server: ${data}`.trim());
    if (!startedFuncCalled) {
      startedFuncCalled = true;
      try {
        startedFunc();
      } catch (err) {
        console.log(`MCP Server process failed to start, ${err}`);
        exitFunc(1);
      }
    }
  });
  mcpServerProcess.on('close', (code) => {
    console.log(`MCP Server process exited with code ${code}`);
    exitFunc(code);
  });
}