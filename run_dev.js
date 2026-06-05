const { spawn } = require('child_process');
const path = require('path');

const nodePath = path.resolve(__dirname, 'node', 'node.exe');
const npmPath = path.resolve(__dirname, 'node', 'npm.cmd');

console.log("Starting Express Backend Server...");
const server = spawn(nodePath, [path.resolve(__dirname, 'server', 'index.js')], { stdio: 'inherit', shell: true });

console.log("Starting Vite Frontend Server...");
const client = spawn(npmPath, ['run', 'dev'], { cwd: path.resolve(__dirname, 'client'), stdio: 'inherit', shell: true });

process.on('SIGINT', () => {
    console.log("Shutting down servers...");
    server.kill();
    client.kill();
    process.exit();
});
