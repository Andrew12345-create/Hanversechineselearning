import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { cwd } from 'process';

const hooksDir = '.githooks';
const hookScript = `${hooksDir}/pre-push`;

if (!existsSync(hookScript)) {
  console.warn(`Git hook script not found at ${hookScript}.`);
  process.exit(0);
}

try {
  const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  const currentHookPath = execSync('git config --local core.hooksPath', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

  if (currentHookPath !== hooksDir) {
    execSync(`git config --local core.hooksPath ${hooksDir}`, { stdio: ['pipe', 'pipe', 'inherit'] });
    console.log(`Configured local git hooks path to ${hooksDir}`);
  }
} catch (error) {
  if (error.status === 1) {
    execSync(`git config --local core.hooksPath ${hooksDir}`, { stdio: ['pipe', 'pipe', 'inherit'] });
    console.log(`Configured local git hooks path to ${hooksDir}`);
  } else {
    console.warn('Unable to configure git hooks path:', error.message);
  }
}
