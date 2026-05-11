export function createGroupManagementPayload(options = {}) {
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : (() => ({}));
  const collectRuntimeGroups = typeof options.collectRuntimeGroups === 'function'
    ? options.collectRuntimeGroups
    : (async () => ({ status: {}, records: new Map() }));
  const collectConfiguredGroups = typeof options.collectConfiguredGroups === 'function'
    ? options.collectConfiguredGroups
    : (() => []);
  const mergeRecords = typeof options.mergeRecords === 'function'
    ? options.mergeRecords
    : ((runtimeRecords = new Map()) => runtimeRecords);
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : (value => String(value || '').trim());
  const upsertRecord = typeof options.upsertRecord === 'function' ? options.upsertRecord : (() => null);
  const serializeRecord = typeof options.serializeRecord === 'function'
    ? options.serializeRecord
    : ((record = {}) => record);
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({}));
  const getSafetyConfig = typeof options.getSafetyConfig === 'function' ? options.getSafetyConfig : (() => ({}));
  const buildDefaultsPayload = typeof options.buildDefaultsPayload === 'function'
    ? options.buildDefaultsPayload
    : (() => ({}));
  const getListSummary = typeof options.getListSummary === 'function' ? options.getListSummary : (() => ({}));
  const buildHealthPayload = typeof options.buildHealthPayload === 'function'
    ? options.buildHealthPayload
    : (() => ({}));

  async function buildPayload(query = {}) {
    const allConfigs = getAllConfigs() || {};
    const runtime = await collectRuntimeGroups();
    const configured = collectConfiguredGroups(allConfigs);
    const merged = mergeRecords(runtime.records, configured);
    const selectedGroupId = normalizeGroupId(query.groupId || '');
    if (selectedGroupId && !merged.has(selectedGroupId)) {
      upsertRecord(merged, { groupId: selectedGroupId, source: 'manual' });
    }

    const groups = Array.from(merged.values())
      .map(record => serializeRecord(record, allConfigs))
      .sort((a, b) => {
        const runtimeA = (a.sources || []).some(source => source.startsWith('runtime')) ? 0 : 1;
        const runtimeB = (b.sources || []).some(source => source.startsWith('runtime')) ? 0 : 1;
        if (runtimeA !== runtimeB) return runtimeA - runtimeB;
        return Number(a.groupId) - Number(b.groupId);
      });

    return {
      success: true,
      readOnly: getWebConsoleConfig().readOnly === true,
      runtime: runtime.status,
      safety: getSafetyConfig(),
      defaults: buildDefaultsPayload(allConfigs),
      summary: getListSummary(groups, allConfigs),
      health: buildHealthPayload(groups, allConfigs, runtime.status),
      selectedGroupId,
      groups,
    };
  }

  return {
    buildPayload,
  };
}
