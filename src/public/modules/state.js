export let projects = [];
export let tasks = [];
export let archivedTasks = [];
export let archivedTasksCount = 0;
export let settings = { enableCliAgent: false, cliCommand: "agy", autoTriggerOnInProgress: true, dataDirectoryPath: "", fontSize: "small" };
export let projectGitStatus = {};
export let currentProject = "ALL";
export let currentBranch = "ALL";
export let projectBranchesMap = {};
export let groupByBranch = false;
export let currentActiveTaskDiff = "";
export let currentTaskDependencies = [];
export let currentModalEditingTask = null;
export let selectedFirstLaunchPath = "";
export const selectedArchivedTaskIds = new Set();
export let isOpenedFromArchive = false;
export let expandedProjectId = null;

export function setProjects(val) { projects = val; if (typeof window !== "undefined") window.projects = val; }
export function setTasks(val) { tasks = val; if (typeof window !== "undefined") window.tasks = val; }
export function setArchivedTasks(val) { archivedTasks = Array.isArray(val) ? val : []; if (typeof window !== "undefined") window.archivedTasks = archivedTasks; }
export function setArchivedTasksCount(val) { archivedTasksCount = Number(val) || 0; if (typeof window !== "undefined") window.archivedTasksCount = archivedTasksCount; }
export function setSettings(val) { settings = val; if (typeof window !== "undefined") window.settings = val; }
export function setProjectGitStatus(val) { projectGitStatus = val; if (typeof window !== "undefined") window.projectGitStatus = val; }
export function setCurrentProject(val) { currentProject = val; if (typeof window !== "undefined") window.currentProject = val; }
export function setCurrentBranch(val) { currentBranch = val || "ALL"; if (typeof window !== "undefined") window.currentBranch = currentBranch; }
export function setProjectBranchesMap(val) { projectBranchesMap = val || {}; if (typeof window !== "undefined") window.projectBranchesMap = projectBranchesMap; }
export function setGroupByBranch(val) { groupByBranch = Boolean(val); if (typeof window !== "undefined") window.groupByBranch = groupByBranch; }
export function setCurrentActiveTaskDiff(val) { currentActiveTaskDiff = val; if (typeof window !== "undefined") window.currentActiveTaskDiff = val; }
export function setCurrentTaskDependencies(val) { currentTaskDependencies = val; if (typeof window !== "undefined") window.currentTaskDependencies = val; }
export function setCurrentModalEditingTask(val) { currentModalEditingTask = val; if (typeof window !== "undefined") window.currentModalEditingTask = val; }
export function setSelectedFirstLaunchPath(val) { selectedFirstLaunchPath = val; if (typeof window !== "undefined") window.selectedFirstLaunchPath = val; }
export function setIsOpenedFromArchive(val) { isOpenedFromArchive = Boolean(val); if (typeof window !== "undefined") window.isOpenedFromArchive = isOpenedFromArchive; }
export function setExpandedProjectId(val) { expandedProjectId = val || null; if (typeof window !== "undefined") window.expandedProjectId = expandedProjectId; }

if (typeof window !== "undefined") {
  window.projects = projects;
  window.tasks = tasks;
  window.archivedTasks = archivedTasks;
  window.archivedTasksCount = archivedTasksCount;
  window.settings = settings;
  window.projectGitStatus = projectGitStatus;
  window.currentProject = currentProject;
  window.currentBranch = currentBranch;
  window.projectBranchesMap = projectBranchesMap;
  window.groupByBranch = groupByBranch;
  window.currentActiveTaskDiff = currentActiveTaskDiff;
  window.currentTaskDependencies = currentTaskDependencies;
  window.currentModalEditingTask = currentModalEditingTask;
  window.selectedFirstLaunchPath = selectedFirstLaunchPath;
  window.selectedArchivedTaskIds = selectedArchivedTaskIds;
  window.isOpenedFromArchive = isOpenedFromArchive;
  window.expandedProjectId = expandedProjectId;
  window.setProjects = setProjects;
  window.setTasks = setTasks;
  window.setArchivedTasks = setArchivedTasks;
  window.setArchivedTasksCount = setArchivedTasksCount;
  window.setSettings = setSettings;
  window.setProjectGitStatus = setProjectGitStatus;
  window.setCurrentProject = setCurrentProject;
  window.setCurrentBranch = setCurrentBranch;
  window.setProjectBranchesMap = setProjectBranchesMap;
  window.setGroupByBranch = setGroupByBranch;
  window.setCurrentActiveTaskDiff = setCurrentActiveTaskDiff;
  window.setCurrentTaskDependencies = setCurrentTaskDependencies;
  window.setCurrentModalEditingTask = setCurrentModalEditingTask;
  window.setSelectedFirstLaunchPath = setSelectedFirstLaunchPath;
  window.setIsOpenedFromArchive = setIsOpenedFromArchive;
  window.setExpandedProjectId = setExpandedProjectId;
}
