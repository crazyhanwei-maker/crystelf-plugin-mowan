import fs from 'fs/promises';
import path from 'path';

globalThis.logger ||= {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const root = process.cwd();
const configDir = path.join(root, 'config');
const DERIVED_SCHEMA_FIELDS = new Set([
  'coreConfig.usageControl.dailySummary',
  'coreConfig.usageControl.dailySceneSummary',
  'coreConfig.usageControl.dailyModelSummary',
  'coreConfig.usageControl.dailyCostSummary',
  'coreConfig.usageControl.dailyModelCostSummary',
  'coreConfig.usageControl.dailyLogFile',
  'coreConfig.usageControl.totalLogFile',
  'coreConfig.tools.tts.modelSummary',
]);

function hasOwnPath(source, parts = []) {
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      return false;
    }
    current = current[part];
  }
  return true;
}

function normalizeComponentName(value = '') {
  return String(value || '').trim();
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function loadConfigFiles() {
  const entries = await fs.readdir(configDir, { withFileTypes: true });
  const configs = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const name = path.basename(entry.name, '.json');
    configs[name] = await readJson(path.join(configDir, entry.name));
  }
  return configs;
}

async function main() {
  const [{ default: guobaSchema }, configs] = await Promise.all([
    import('../guoba/configSchema.js'),
    loadConfigFiles(),
  ]);

  const schemaItems = Array.isArray(guobaSchema)
    ? guobaSchema.filter(item => item?.field)
    : [];
  const missingRoots = [];
  const missingFields = [];
  const invalidSecretComponents = [];
  const duplicateFields = [];
  const seenFields = new Set();

  for (const item of schemaItems) {
    const field = String(item.field || '').trim();
    if (!field) continue;
    if (seenFields.has(field)) {
      duplicateFields.push(field);
      continue;
    }
    seenFields.add(field);

    const [configName, ...pathParts] = field.split('.');
    if (!configs[configName]) {
      missingRoots.push(field);
      continue;
    }
    if (!DERIVED_SCHEMA_FIELDS.has(field) && !hasOwnPath(configs[configName], pathParts)) {
      missingFields.push(field);
    }

    const lowerField = field.toLowerCase();
    const component = normalizeComponentName(item.component);
    const sensitive = /(^|\.)(apikey|apiKey|token|password|secret|authorization|cookie)(\.|$)/i.test(field)
      || lowerField.endsWith('apikey')
      || lowerField.endsWith('api_key');
    if (sensitive && component !== 'InputPassword') {
      invalidSecretComponents.push(`${field} 使用 ${component || '未知组件'}`);
    }
  }

  const ok = missingRoots.length === 0
    && missingFields.length === 0
    && duplicateFields.length === 0
    && invalidSecretComponents.length === 0;

  const result = {
    ok,
    schemaFields: schemaItems.length,
    configFiles: Object.keys(configs).sort(),
    derivedFields: Array.from(DERIVED_SCHEMA_FIELDS),
    missingRoots,
    missingFields,
    duplicateFields,
    invalidSecretComponents,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
});
