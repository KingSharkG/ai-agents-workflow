/**
 * Shared utility: plugin root resolution and version reading.
 *
 * All hooks that need CLAUDE_PLUGIN_ROOT should import from here
 * instead of inlining the fallback logic.
 */

const path = require('path');
const fs = require('fs');

/**
 * Resolve the plugin root directory.
 * Uses CLAUDE_PLUGIN_ROOT env var (set by the Claude Code harness),
 * falling back to __dirname/.. for local development.
 * Validates that the resolved path looks like a real plugin installation.
 */
function resolvePluginRoot() {
  const root =
    process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');

  const marker = path.join(root, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(marker)) {
    console.error(
      `[plugin-root] WARNING: PLUGIN_ROOT=${root} does not contain .claude-plugin/plugin.json.\n` +
        `The plugin installation may be broken or mid-update.\n` +
        `If this persists, reinstall: /plugin uninstall ai-agents-workflow && /plugin install ai-agents-workflow@ai-agents-workflow\n`,
    );
  }

  return root;
}

/**
 * Read the plugin version from .claude-plugin/plugin.json.
 * Returns 'unknown' if the file is missing or unreadable.
 */
function getPluginVersion(pluginRoot) {
  try {
    const root = pluginRoot || resolvePluginRoot();
    const pluginJson = JSON.parse(
      fs.readFileSync(
        path.join(root, '.claude-plugin', 'plugin.json'),
        'utf8',
      ),
    );
    return pluginJson.version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

module.exports = { resolvePluginRoot, getPluginVersion };
