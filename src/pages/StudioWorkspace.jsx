import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addWorkflowEdge,
  addWorkflowNode,
  createApplication,
  createGenerationSession,
  createReference,
  createWorkflow,
  deleteReference,
  fetchApplications,
  fetchAssets,
  fetchGenerationBatches,
  fetchGenerationJobs,
  fetchGenerationSessions,
  fetchHistory,
  fetchLedger,
  fetchProjects,
  fetchProviderStatus,
  fetchReferences,
  fetchVersions,
  fetchWorkflows,
  saveProject,
  updateGenerationSession,
  updateProject,
  updateReference,
} from '../lib/api-client';
import './StudioWorkspace.css';

const SECTIONS = [
  ['projects', 'Projects'],
  ['sessions', 'Sessions'],
  ['references', 'References'],
  ['history', 'History'],
  ['queue', 'Queue'],
  ['versions', 'Versions'],
  ['workflows', 'Workflows'],
  ['applications', 'Applications'],
  ['credits', 'Credits'],
];

function array(value) {
  return Array.isArray(value) ? value : [];
}

function itemTitle(item = {}) {
  return item.displayName || item.title || item.name || item.originalName || item.label || item.id || 'Untitled';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function statusText(value = '') {
  return String(value || 'ready').replaceAll('_', ' ');
}

export default function StudioWorkspace({ section = 'projects' }) {
  const navigate = useNavigate();
  const activeSection = SECTIONS.some(([id]) => id === section) ? section : 'projects';
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [assets, setAssets] = useState([]);
  const [references, setReferences] = useState([]);
  const [history, setHistory] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [batches, setBatches] = useState([]);
  const [versions, setVersions] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [applications, setApplications] = useState([]);
  const [instances, setInstances] = useState([]);
  const [providers, setProviders] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [referenceName, setReferenceName] = useState('');
  const [referenceType, setReferenceType] = useState('IMAGE');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [notice, setNotice] = useState('Loading SLT workspace...');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const results = await Promise.all([
      fetchProjects(),
      fetchGenerationSessions(),
      fetchAssets(),
      fetchReferences(),
      fetchHistory(),
      fetchGenerationJobs('', 100),
      fetchGenerationBatches(),
      fetchVersions(),
      fetchWorkflows(),
      fetchApplications(),
      fetchProviderStatus(),
      fetchLedger(),
    ]);
    const [projectResult, sessionResult, assetResult, referenceResult, historyResult, jobResult, batchResult, versionResult, workflowResult, applicationResult, providerResult, ledgerResult] = results;
    if (projectResult.ok) setProjects(array(projectResult.data?.projects));
    if (sessionResult.ok) setSessions(array(sessionResult.data?.sessions));
    if (assetResult.ok) setAssets(array(assetResult.data?.assets));
    if (referenceResult.ok) setReferences(array(referenceResult.data?.references));
    if (historyResult.ok) setHistory(array(historyResult.data?.history));
    if (jobResult.ok) setJobs(array(jobResult.data?.jobs));
    if (batchResult.ok) setBatches(array(batchResult.data?.batches));
    if (versionResult.ok) setVersions(array(versionResult.data?.versions || versionResult.data?.assets));
    if (workflowResult.ok) setWorkflows(array(workflowResult.data?.workflows));
    if (applicationResult.ok) {
      setApplications(array(applicationResult.data?.applications));
      setInstances(array(applicationResult.data?.instances));
    }
    if (providerResult.ok) setProviders(array(providerResult.data?.providers));
    if (ledgerResult.ok) setWallet(ledgerResult.data?.wallet || null);
    const failure = results.find((item) => !item.ok);
    setNotice(failure?.message || 'Shared workspace synchronized.');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedProject = projects.find((item) => item.id === selectedProjectId) || null;
  const selectedAsset = assets.find((item) => item.id === selectedAssetId) || null;
  const activeJobs = useMemo(() => jobs.filter((item) => !['completed', 'failed', 'cancelled', 'canceled'].includes(String(item.status || '').toLowerCase())), [jobs]);

  const perform = async (action, successMessage) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    setNotice(result.ok ? successMessage : result.message || result.data?.readableError || 'The action failed.');
    if (result.ok) await refresh();
    return result;
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) return setNotice('Write a Project name first.');
    const result = await perform(() => saveProject({ title: projectName.trim(), kind: 'multimodal' }), 'Project created.');
    if (result.ok) {
      setSelectedProjectId(result.data.project.id);
      setProjectName('');
    }
  };

  const handleCreateSession = async () => {
    if (!sessionName.trim()) return setNotice('Write a Session name first.');
    const result = await perform(() => createGenerationSession({
      title: sessionName.trim(),
      kind: 'multimodal',
      projectId: selectedProjectId || null,
    }), 'Session created.');
    if (result.ok) setSessionName('');
  };

  const handleCreateReference = async () => {
    if (!selectedAssetId) return setNotice('Select an Asset first.');
    const result = await perform(() => createReference({
      assetId: selectedAssetId,
      referenceType,
      name: referenceName.trim() || itemTitle(selectedAsset),
      projectId: selectedProjectId || null,
    }), 'Reusable reference created.');
    if (result.ok) setReferenceName('');
  };

  const handleCreateWorkflow = async () => {
    if (!workflowName.trim()) return setNotice('Write a Workflow name first.');
    const result = await perform(() => createWorkflow({ name: workflowName.trim(), projectId: selectedProjectId || null }), 'Workflow created.');
    if (result.ok) setWorkflowName('');
  };

  const addWorkflowPair = async (workflow) => {
    setBusy(true);
    const source = await addWorkflowNode(workflow.id, { nodeType: 'IMAGE', label: 'Generate frame', position: { x: 80, y: 100 } });
    if (!source.ok) {
      setBusy(false);
      return setNotice(source.message || 'Could not create source node.');
    }
    const target = await addWorkflowNode(workflow.id, { nodeType: 'VIDEO', label: 'Animate frame', position: { x: 360, y: 100 } });
    if (!target.ok) {
      setBusy(false);
      return setNotice(target.message || 'Could not create target node.');
    }
    const edge = await addWorkflowEdge(workflow.id, { sourceNodeId: source.data.node.id, targetNodeId: target.data.node.id });
    setBusy(false);
    setNotice(edge.ok ? 'Real Image → Video nodes and edge added.' : edge.message || 'Could not connect workflow nodes.');
    if (edge.ok) await refresh();
  };

  const launchApplication = async (definition) => {
    if (definition.status !== 'AVAILABLE') return setNotice(`${definition.label} · Coming Soon: ${definition.reason || 'integration not connected'}.`);
    const result = await perform(() => createApplication({
      appType: definition.id,
      projectId: selectedProjectId || null,
      title: definition.label,
    }), `${definition.label} workspace created.`);
    if (result.ok && result.data?.definition?.route) navigate(result.data.definition.route);
  };

  const cardActions = (item, type) => {
    if (type === 'project') return <><button type="button" onClick={() => setSelectedProjectId(item.id)}>Select</button><button type="button" onClick={() => perform(() => updateProject(item.id, { status: item.status === 'archived' ? 'ACTIVE' : 'ARCHIVED' }), item.status === 'archived' ? 'Project restored.' : 'Project archived.')}>{item.status === 'archived' ? 'Restore' : 'Archive'}</button></>;
    if (type === 'session') return <button type="button" onClick={() => perform(() => updateGenerationSession(item.id, { status: item.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED' }), 'Session status updated.')}>{item.status === 'ARCHIVED' ? 'Restore' : 'Archive'}</button>;
    if (type === 'reference') return <><button type="button" onClick={() => perform(() => updateReference(item.id, { name: `${item.name} copy` }), 'Reference renamed.')}>Rename</button><button type="button" onClick={() => perform(() => deleteReference(item.id), 'Reference removed without deleting its Asset.')}>Remove</button></>;
    return null;
  };

  const renderContent = () => {
    if (activeSection === 'projects') return <><div className="workspace-create"><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project name" /><button type="button" disabled={busy} onClick={handleCreateProject}>Create Project</button></div><div className="workspace-cards">{projects.map((item) => <article key={item.id} className={selectedProjectId === item.id ? 'is-selected' : ''}><p>Project · {statusText(item.status)}</p><h2>{itemTitle(item)}</h2><small>{item.kind} · {formatDate(item.updatedAt || item.createdAt)}</small><div>{cardActions(item, 'project')}</div></article>)}</div></>;
    if (activeSection === 'sessions') return <><div className="workspace-create"><select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">No Project</option>{projects.map((item) => <option key={item.id} value={item.id}>{itemTitle(item)}</option>)}</select><input value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="Session name" /><button type="button" disabled={busy} onClick={handleCreateSession}>Create Session</button></div><div className="workspace-cards">{sessions.map((item) => <article key={item.id}><p>Session · {statusText(item.status)}</p><h2>{itemTitle(item)}</h2><small>{item.kind} · {item.assetCount || 0} Assets · {item.jobCount || 0} Jobs</small><div>{cardActions(item, 'session')}</div></article>)}</div></>;
    if (activeSection === 'references') return <><div className="workspace-create is-wrap"><select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">All Projects</option>{projects.map((item) => <option key={item.id} value={item.id}>{itemTitle(item)}</option>)}</select><select value={selectedAssetId} onChange={(event) => setSelectedAssetId(event.target.value)}><option value="">Select Asset</option>{assets.map((item) => <option key={item.id} value={item.id}>{itemTitle(item)} · {item.kind}</option>)}</select><select value={referenceType} onChange={(event) => setReferenceType(event.target.value)}>{['FACE', 'CHARACTER', 'IMAGE', 'STYLE', 'PRODUCT', 'LOCATION', 'AUDIO', 'MUSIC', 'VOICE'].map((item) => <option key={item}>{item}</option>)}</select><input value={referenceName} onChange={(event) => setReferenceName(event.target.value)} placeholder="Reference name" /><button type="button" disabled={busy} onClick={handleCreateReference}>Save Reference</button></div><div className="workspace-cards">{references.map((item) => <article key={item.id}><p>{item.referenceType} reference</p><h2>{item.name}</h2><small>{item.asset?.contentType || item.assetId} · {formatDate(item.updatedAt)}</small><div>{cardActions(item, 'reference')}</div></article>)}</div></>;
    if (activeSection === 'history') return <div className="workspace-table">{history.map((item) => <article key={item.id}><b>{itemTitle(item)}</b><span>{item.kind}</span><span>{item.provider || 'SLT'}</span><span>{statusText(item.status)}</span><small>{formatDate(item.createdAt)}</small></article>)}</div>;
    if (activeSection === 'queue') return <><div className="workspace-summary"><strong>{activeJobs.length}</strong><span>active Jobs</span><strong>{batches.length}</strong><span>Batches</span></div><div className="workspace-table">{jobs.map((item) => <article key={item.id}><b>{item.title || `${item.kind} Job`}</b><span>{item.provider || 'SLT Auto'}</span><span>{statusText(item.status)}</span><span>{Number(item.progress || 0)}%</span><small>{item.batchId || item.id}</small></article>)}</div></>;
    if (activeSection === 'versions') return <div className="workspace-cards">{versions.map((item) => <article key={item.id}><p>{item.versionType || 'GENERATION'} · v{item.version || 1}</p><h2>{itemTitle(item)}</h2><small>{item.kind} · parent {item.parentVersionId || item.parentAssetId || 'original'}</small><div><Link to={`/library?assetId=${encodeURIComponent(item.id)}`}>Open Asset</Link>{item.kind === 'image' ? <Link to={`/image?referenceAssetId=${encodeURIComponent(item.id)}&versionType=VARIATION`}>Create variation</Link> : null}</div></article>)}</div>;
    if (activeSection === 'workflows') return <><div className="workspace-create"><select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">No Project</option>{projects.map((item) => <option key={item.id} value={item.id}>{itemTitle(item)}</option>)}</select><input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} placeholder="Workflow name" /><button type="button" disabled={busy} onClick={handleCreateWorkflow}>Create Workflow</button></div><div className="workspace-cards">{workflows.map((item) => <article key={item.id}><p>Workflow · {statusText(item.status)}</p><h2>{item.name}</h2><small>{item.nodes?.length || 0} nodes · {item.edges?.length || 0} edges</small><div><button type="button" disabled={busy} onClick={() => addWorkflowPair(item)}>Add Image → Video flow</button></div></article>)}</div></>;
    if (activeSection === 'applications') return <div className="workspace-cards">{applications.map((item) => <article key={item.id}><p>Application · {statusText(item.status)}</p><h2>{item.label}</h2><small>{item.status === 'AVAILABLE' ? 'Integrated with the current SLT routes.' : item.reason || 'Coming Soon'}</small><div><button type="button" disabled={busy || item.status !== 'AVAILABLE'} onClick={() => launchApplication(item)}>{item.status === 'AVAILABLE' ? 'Open Application' : 'Coming Soon'}</button></div></article>)}{instances.map((item) => <article key={item.id}><p>Saved instance</p><h2>{item.title}</h2><small>{item.appType} · {statusText(item.status)}</small></article>)}</div>;
    return <div className="workspace-credit-grid"><article><p>SLT Wallet</p><strong>{wallet?.availableCredits ?? '—'}</strong><span>Available credits</span><small>{wallet?.heldCredits ?? 0} held · {wallet?.capturedCredits ?? 0} captured</small></article>{providers.map((item) => <article key={item.name}><p>{item.kind}</p><h2>{item.name}</h2><strong>{item.available ? 'Available' : item.errorName || statusText(item.status)}</strong><small>{item.available ? item.model?.label || item.execution : item.message}</small></article>)}</div>;
  };

  return (
    <main className="studio-workspace-page">
      <header>
        <div><p>Sweet Little Trauma Studio</p><h1>Multimodal Workspace</h1><span>{selectedProject ? `Active Project: ${itemTitle(selectedProject)}` : 'One durable system for every creative modality.'}</span></div>
        <div className="studio-workspace-shortcuts"><Link to="/image">Image</Link><Link to="/video">Video</Link><Link to="/music">Music</Link><Link to="/sound">Sound</Link><Link to="/scene-builder">Scene Builder</Link><Link to="/characters">Characters</Link><Link to="/library">Asset Library</Link></div>
      </header>
      <nav className="studio-workspace-nav">{SECTIONS.map(([id, label]) => <Link key={id} className={id === activeSection ? 'is-active' : ''} to={`/${id}`}>{label}</Link>)}</nav>
      <section className="studio-workspace-content">
        <div className="studio-workspace-heading"><div><p>{activeSection}</p><h2>{SECTIONS.find(([id]) => id === activeSection)?.[1]}</h2></div><button type="button" disabled={busy} onClick={refresh}>Refresh</button></div>
        {renderContent()}
        {!['credits', 'queue'].includes(activeSection) && !({ projects, sessions, references, history, versions, workflows, applications }[activeSection]?.length) ? <p className="workspace-empty">No {activeSection} yet. Use the real action above to create the first one.</p> : null}
      </section>
      <footer><span>{notice}</span><span>{projects.length} Projects · {sessions.length} Sessions · {assets.length} Assets · {jobs.length} Jobs</span></footer>
    </main>
  );
}
