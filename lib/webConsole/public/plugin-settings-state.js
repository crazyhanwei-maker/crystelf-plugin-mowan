function getInitialPluginSettingsSearchKeyword() {
  try {
    return String(new URLSearchParams(window.location.search).get('search') || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

const pluginSettingsState = {
  payload: null,
  draft: {},
  skillsDraft: null,
  skillsExpanded: (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('crystelf-plugin-settings-skills-expanded') || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  })(),
  skillsFilter: localStorage.getItem('crystelf-plugin-settings-skills-filter') || 'all',
  skillsSearchKeyword: localStorage.getItem('crystelf-plugin-settings-skills-search') || '',
  skillsEditorPayload: null,
  skillsEditorText: '',
  skillsEditorSource: 'effective',
  skillsEditorStatus: '',
  activeCategory: 'main',
  activeGroup: '',
  activeTopTab: 'plugin-settings-config-panel',
  overview: null,
  editableConfig: null,
  navCollapsed: localStorage.getItem('crystelf-plugin-settings-nav-collapsed') === 'true',
  searchKeyword: getInitialPluginSettingsSearchKeyword(),
  knowledgeGenerateQuery: '',
  knowledgeGenerateLoading: false,
  knowledgeGenerateStatus: '',
  knowledgeGenerateSources: [],
  knowledgeGeneratePreview: '',
  knowledgeGenerateMode: 'replace',
  knowledgeHistory: [],
  knowledgeSelectedPreviewIds: [],
  knowledgeHistoryPreviewId: '',
  recommendationStatus: '',
  recommendationUndo: null,
  featureManageStatus: '',
  featureManageHistory: [],
  helpPreviewDataUrl: '',
  helpPreviewStatus: '',
  privateAiSafety: null,
  privateAiSafetyStatus: '',
  privateAiSafetyView: {
    keyword: '',
    action: 'all',
    pageSize: 10,
    blacklistPage: 1,
    warningPage: 1,
    recordPage: 1,
  },
  ttsModelsRefreshing: false,
  ttsModelsRefreshStatus: '',
  authStatus: null,
};

if (window.matchMedia?.('(max-width: 900px)').matches) {
  pluginSettingsState.navCollapsed = true;
}

let pluginSettingsSkillsLayoutObserver = null;

const KNOWLEDGE_HISTORY_STORAGE_KEY = 'crystelf-knowledge-history';
const FEATURE_MANAGE_HISTORY_STORAGE_KEY = 'crystelf-feature-manage-history';
const SKILLS_FILTER_STORAGE_KEY = 'crystelf-plugin-settings-skills-filter';
const SKILLS_EXPANDED_STORAGE_KEY = 'crystelf-plugin-settings-skills-expanded';
const SKILLS_SEARCH_STORAGE_KEY = 'crystelf-plugin-settings-skills-search';
