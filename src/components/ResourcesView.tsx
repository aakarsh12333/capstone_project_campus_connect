import { BookOpen, Download, ExternalLink, FileText, Plus, Search, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { incrementResourceDownload, shareAcademicResource } from '../services/campusService';
import {
  ACCEPT_UPLOAD_EXTENSIONS,
  formatClientFileSizeLabel,
  isLocalResourceUrl,
  openOrDownloadResource,
  uploadLocalResourceFile,
  validateLocalUploadFile,
} from '../services/localFileStore';
import {
  SCHEMA_LIMITS,
  type AcademicResource,
  type CampusGroup,
  type ResourceType,
  type UserPublicProfile,
} from '../types/campus';

interface ResourcesViewProps {
  profile: UserPublicProfile | null;
  groups: CampusGroup[];
  resourcesByGroup: Record<string, AcademicResource[]>;
}

const RESOURCE_FILTERS: Array<{ id: 'all' | ResourceType; label: string }> = [
  { id: 'all', label: 'All Materials' },
  { id: 'lecture_notes', label: 'Lecture Notes' },
  { id: 'research_paper', label: 'Papers' },
  { id: 'lab_guide', label: 'Lab Guides' },
  { id: 'code_repo', label: 'Repositories' },
  { id: 'dataset', label: 'Datasets' },
];

export function ResourcesView({ profile, groups, resourcesByGroup }: ResourcesViewProps) {
  const [filterType, setFilterType] = useState<'all' | ResourceType>('all');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  // Share form state
  const [formGroupId, setFormGroupId] = useState(groups[0]?.id || '');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formSubject, setFormSubject] = useState('Computer Science');
  const [formTopic, setFormTopic] = useState('');
  const [formType, setFormType] = useState<ResourceType>('lecture_notes');
  const [sourceMode, setSourceMode] = useState<'upload' | 'url'>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [formUrl, setFormUrl] = useState('https://');
  const [formSize, setFormSize] = useState('1.5 MB PDF');
  const [formError, setFormError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (groups.length > 0 && !groups.some((g) => g.id === formGroupId)) {
      setFormGroupId(groups[0].id);
    }
  }, [groups, formGroupId]);

  const allResources = useMemo(() => {
    const list: Array<AcademicResource & { groupCode: string }> = [];
    for (const grp of groups) {
      const items = resourcesByGroup[grp.id] || [];
      for (const item of items) {
        list.push({ ...item, groupCode: grp.code });
      }
    }
    return list;
  }, [groups, resourcesByGroup]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allResources.filter((item) => {
      if (filterType !== 'all' && item.resourceType !== filterType) return false;
      if (selectedGroupFilter !== 'all' && item.groupId !== selectedGroupFilter) return false;
      if (
        q &&
        !item.title.toLowerCase().includes(q) &&
        !item.subject.toLowerCase().includes(q) &&
        !item.topic.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allResources, filterType, selectedGroupFilter, search]);

  const handleSelectLocalFile = (file: File | null) => {
    setFormError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const validationError = validateLocalUploadFile(file);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSelectedFile(file);
    setFormSize(formatClientFileSizeLabel(file.size, file.name));

    if (!formTitle.trim()) {
      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (baseName) {
        setFormTitle(baseName.slice(0, SCHEMA_LIMITS.resourceTitleMax));
      }
    }
  };

  const handleDownload = async (res: AcademicResource) => {
    if (!profile) return;
    setDownloadError(null);
    try {
      await openOrDownloadResource({ url: res.url, title: res.title });
      await incrementResourceDownload({
        groupId: res.groupId,
        resourceId: res.id,
        userId: profile.uid,
        userRole: profile.role,
        department: profile.department,
      });
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Unable to access this resource right now.',
      );
    }
  };

  const resetForm = () => {
    setFormTitle('');
    setFormDesc('');
    setFormTopic('');
    setFormUrl('https://');
    setSelectedFile(null);
    setFormSize('1.5 MB PDF');
    setFormError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleShareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const targetGroupId = formGroupId || groups[0]?.id;
    if (!profile || !targetGroupId) {
      setFormError('Create or join an academic channel before sharing a resource.');
      return;
    }
    if (!formTitle.trim()) {
      setFormError('Please provide a title for this resource.');
      return;
    }

    let finalUrl = formUrl.trim();
    let finalSize = formSize.trim();

    if (sourceMode === 'upload') {
      if (!selectedFile) {
        setFormError('Please select a file from your computer to upload.');
        return;
      }
    } else {
      if (!finalUrl || finalUrl === 'https://' || finalUrl === 'http://') {
        setFormError('Please enter a valid resource URL or switch to Upload from Computer.');
        return;
      }
    }

    setSaving(true);
    try {
      if (sourceMode === 'upload' && selectedFile) {
        const uploaded = await uploadLocalResourceFile(selectedFile, targetGroupId);
        finalUrl = uploaded.url;
        finalSize = finalSize || uploaded.fileSizeLabel;
      }

      await shareAcademicResource({
        groupId: targetGroupId,
        title: formTitle,
        description: formDesc,
        subject: formSubject,
        topic: formTopic || 'Course Material',
        resourceType: formType,
        url: finalUrl,
        fileSizeLabel: finalSize,
        authorId: profile.uid,
        authorName: profile.displayName,
        authorRole: profile.role,
        department: profile.department,
      });
      setModalOpen(false);
      resetForm();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to upload and publish resource.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] dark:bg-[#0B0F19] p-4 sm:p-8 pb-24 md:pb-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">
              Academic Resource Vault
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Group-verified lecture notes, research papers, datasets, and lab guides.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!formGroupId && groups[0]) setFormGroupId(groups[0].id);
              setModalOpen(true);
            }}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#4f46e5] hover:bg-[#4338ca] text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Share Resource</span>
          </button>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 lg:pb-0">
            {RESOURCE_FILTERS.map((tab) => {
              const active = filterType === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterType(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#4f46e5] text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedGroupFilter}
              onChange={(e) => setSelectedGroupFilter(e.target.value)}
              className="min-h-[38px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-xs"
            >
              <option value="all">All Channels</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2 px-3 min-h-[38px] rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or topic..."
                className="bg-transparent text-xs outline-none w-full"
              />
            </div>
          </div>
        </div>

        {/* Download Error Banner */}
        {downloadError && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300">
            <span>{downloadError}</span>
            <button
              type="button"
              onClick={() => setDownloadError(null)}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Resource List */}
        {filtered.length === 0 ? (
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center">
            <BookOpen className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <h3 className="text-base font-bold font-display mb-1">No matching resources</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              Share a paper, dataset, or lecture handout with your academic channel.
            </p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-[#4f46e5] text-white text-sm font-medium cursor-pointer"
            >
              Share First Resource
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {filtered.map((res) => {
              const isLocal = isLocalResourceUrl(res.url);
              return (
                <div
                  key={res.id}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                      <span className="font-mono font-semibold text-[#3525cd] dark:text-[#a5b4fc]">
                        {res.groupCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{res.subject}</span>
                      <span aria-hidden="true">·</span>
                      <span>{res.topic}</span>
                      {res.fileSizeLabel && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{res.fileSizeLabel}</span>
                        </>
                      )}
                      {isLocal && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            Local Upload
                          </span>
                        </>
                      )}
                    </div>

                    <h3 className="text-base font-semibold font-display text-[#171b26] dark:text-[#eef0ff]">
                      {res.title}
                    </h3>

                    {res.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
                        {res.description}
                      </p>
                    )}

                    <div className="text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                      Shared by {res.authorName}
                      <span aria-hidden="true"> · </span>
                      <span className="tabular-nums">{res.downloadsCount} accesses</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDownload(res)}
                      className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B0F19] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-[#4f46e5] dark:text-[#a5b4fc]" />
                      <span>{isLocal ? 'Download File' : 'Open & Track'}</span>
                      {!isLocal && <ExternalLink className="w-3 h-3 text-slate-400" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Share Resource Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl my-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold font-display">Share Academic Resource</h2>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setFormError(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleShareSubmit} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Channel</label>
                  <select
                    value={formGroupId}
                    onChange={(e) => setFormGroupId(e.target.value)}
                    disabled={groups.length === 0}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {groups.length === 0 ? (
                      <option value="">No active channels</option>
                    ) : (
                      groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code} — {g.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Resource Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as ResourceType)}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    <option value="lecture_notes">Lecture Notes</option>
                    <option value="research_paper">Research Paper</option>
                    <option value="lab_guide">Lab Guide</option>
                    <option value="code_repo">Code Repository</option>
                    <option value="dataset">Dataset</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Title</label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.resourceTitleMax}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Week 8: Byzantine Fault Tolerance Notes"
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Subject</label>
                  <input
                    type="text"
                    required
                    maxLength={SCHEMA_LIMITS.subjectMax}
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Topic</label>
                  <input
                    type="text"
                    required
                    maxLength={SCHEMA_LIMITS.topicMax}
                    value={formTopic}
                    onChange={(e) => setFormTopic(e.target.value)}
                    placeholder="e.g. Consensus Proofs"
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>
              </div>

              {/* Source Mode Selector: Local File Upload vs External URL */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold">Resource Source</label>
                  <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-[#faf8ff] dark:bg-[#0B0F19]">
                    <button
                      type="button"
                      onClick={() => {
                        setSourceMode('upload');
                        setFormError(null);
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                        sourceMode === 'upload'
                          ? 'bg-[#4f46e5] text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:text-[#171b26] dark:hover:text-white'
                      }`}
                    >
                      Upload File
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSourceMode('url');
                        setFormError(null);
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                        sourceMode === 'url'
                          ? 'bg-[#4f46e5] text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:text-[#171b26] dark:hover:text-white'
                      }`}
                    >
                      External URL
                    </button>
                  </div>
                </div>

                {sourceMode === 'upload' ? (
                  <div className="space-y-2.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPT_UPLOAD_EXTENSIONS}
                      className="hidden"
                      onChange={(e) => handleSelectLocalFile(e.target.files?.[0] || null)}
                    />
                    {selectedFile ? (
                      <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border border-[#4f46e5]/40 bg-[#4f46e5]/5 dark:bg-[#4f46e5]/10">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText className="w-5 h-5 text-[#4f46e5] dark:text-[#a5b4fc] shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate text-[#171b26] dark:text-[#eef0ff]">
                              {selectedFile.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                              {formatClientFileSizeLabel(selectedFile.size, selectedFile.name)}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer shrink-0"
                          title="Remove selected file"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragActive(true);
                        }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragActive(false);
                          const dropped = e.dataTransfer.files?.[0] || null;
                          handleSelectLocalFile(dropped);
                        }}
                        className={`w-full rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors cursor-pointer ${
                          dragActive
                            ? 'border-[#4f46e5] bg-[#4f46e5]/5 dark:bg-[#4f46e5]/10'
                            : 'border-slate-300 dark:border-slate-700 bg-[#faf8ff] dark:bg-[#0B0F19] hover:border-[#4f46e5]/60'
                        }`}
                      >
                        <Upload className="w-5 h-5 text-[#4f46e5] dark:text-[#a5b4fc] mx-auto mb-1.5" />
                        <div className="text-xs font-semibold text-[#171b26] dark:text-[#eef0ff]">
                          Choose a file from your computer or drag and drop
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          PDF, slides, documents, datasets, archives, or images (max 20 MB)
                        </div>
                      </button>
                    )}

                    <div>
                      <label className="block text-xs font-semibold mb-1">Format / Size</label>
                      <input
                        type="text"
                        maxLength={SCHEMA_LIMITS.fileSizeLabelMax}
                        value={formSize}
                        onChange={(e) => setFormSize(e.target.value)}
                        className="w-full min-h-[38px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold mb-1">Resource URL</label>
                      <input
                        type="url"
                        required={sourceMode === 'url'}
                        maxLength={SCHEMA_LIMITS.urlMax}
                        value={formUrl}
                        onChange={(e) => setFormUrl(e.target.value)}
                        placeholder="https://arxiv.org/pdf/..."
                        className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Format / Size</label>
                      <input
                        type="text"
                        maxLength={SCHEMA_LIMITS.fileSizeLabelMax}
                        value={formSize}
                        onChange={(e) => setFormSize(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Summary</label>
                <textarea
                  rows={2}
                  maxLength={SCHEMA_LIMITS.resourceDescMax}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Key takeaways or syllabus module reference..."
                  className="w-full p-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              {formError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalOpen(false);
                    setFormError(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || groups.length === 0}
                  className="px-4 py-2 rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-50 text-white text-sm font-medium cursor-pointer"
                >
                  {saving ? 'Uploading & Publishing...' : 'Publish Resource'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
