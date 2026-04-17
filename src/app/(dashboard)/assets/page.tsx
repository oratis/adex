'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/utils'

interface Asset {
  id: string
  uploadedBy: string
  uploaderName: string | null
  name: string
  type: string
  source: string
  fileUrl: string | null
  thumbnailUrl: string | null
  prompt: string | null
  status: string
  ratio: string | null
  duration: number | null
  tags: string | null
  fileSize: number | null
  isFolder: boolean
  parentId: string | null
  folderPath: string | null
  createdAt: string
}

interface BreadcrumbItem {
  id: string | null  // null = root
  name: string
}

export default function AssetsPage() {
  const { toast } = useToast()
  const [assets, setAssets] = useState<Asset[]>([])
  const [filterType, setFilterType] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [search, setSearch] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadTags, setUploadTags] = useState('')

  // Bulk selection
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkTag, setShowBulkTag] = useState(false)
  const [bulkTagsInput, setBulkTagsInput] = useState('')

  // Folder browsing state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: null, name: 'All Assets' }])

  const loadAssets = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterType) params.set('type', filterType)
    if (filterSource) params.set('source', filterSource)
    if (search) params.set('search', search)
    // Don't filter by status when browsing folders (folders are always "ready")
    if (!currentFolderId && !search) params.set('status', 'ready')

    // Folder browsing
    if (currentFolderId) {
      params.set('parentId', currentFolderId)
    }

    const res = await fetch(api(`/api/assets?${params.toString()}`))
    const data = await res.json()
    const items = Array.isArray(data) ? data : []
    // Sort: folders first, then by name
    items.sort((a: Asset, b: Asset) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      return a.name.localeCompare(b.name)
    })
    setAssets(items)
  }, [filterType, filterSource, search, currentFolderId])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  function navigateToFolder(folder: Asset) {
    setCurrentFolderId(folder.id)
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }])
  }

  function navigateToBreadcrumb(index: number) {
    const crumb = breadcrumbs[index]
    setCurrentFolderId(crumb.id)
    setBreadcrumbs(prev => prev.slice(0, index + 1))
  }

  function handleAssetClick(asset: Asset) {
    if (selectMode && !asset.isFolder) {
      toggleSelect(asset.id)
      return
    }
    if (asset.isFolder) {
      navigateToFolder(asset)
    } else {
      setSelectedAsset(asset)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    // When searching, go to root to search all assets
    if (search) {
      setCurrentFolderId(null)
      setBreadcrumbs([{ id: null, name: 'All Assets' }])
    }
    loadAssets()
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (uploadName) formData.append('name', uploadName)
      if (uploadTags) formData.append('tags', JSON.stringify(uploadTags.split(',').map(t => t.trim())))

      const res = await fetch(api('/api/assets'), { method: 'POST', body: formData })
      if (res.ok) {
        setShowUpload(false)
        setUploadName('')
        setUploadTags('')
        loadAssets()
      }
    } finally {
      setUploading(false)
    }
  }

  async function handleDriveSync() {
    setSyncing(true)
    try {
      const res = await fetch(api('/api/assets/sync'), { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        alert(`Sync failed: ${data.error}`)
      } else {
        alert(`Synced: ${data.synced} files, ${data.folders} folders (${data.skipped} skipped)`)
        loadAssets()
      }
    } catch {
      alert('Sync request failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this asset?')) return
    const res = await fetch(api(`/api/assets/${id}`), { method: 'DELETE' })
    if (res.ok) {
      toast({ variant: 'success', title: 'Asset deleted' })
    } else {
      toast({ variant: 'error', title: 'Delete failed' })
    }
    loadAssets()
    setSelectedAsset(null)
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} selected asset(s)? This cannot be undone.`)) return
    try {
      const res = await fetch(api('/api/assets/bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Bulk delete failed')
      toast({
        variant: 'success',
        title: `Deleted ${data.deleted} asset(s)`,
        description: data.skipped ? `${data.skipped} skipped (not owned)` : undefined,
      })
      exitSelectMode()
      loadAssets()
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : undefined })
    }
  }

  async function handleBulkTag(e: React.FormEvent) {
    e.preventDefault()
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    try {
      const tagsArr = bulkTagsInput.split(',').map(t => t.trim()).filter(Boolean)
      const res = await fetch(api('/api/assets/bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tag', ids, tags: JSON.stringify(tagsArr) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Bulk tag failed')
      toast({
        variant: 'success',
        title: `Tagged ${data.updated} asset(s)`,
        description: data.skipped ? `${data.skipped} skipped (not owned)` : undefined,
      })
      setShowBulkTag(false)
      setBulkTagsInput('')
      exitSelectMode()
      loadAssets()
    } catch (err) {
      toast({ variant: 'error', title: 'Tag failed', description: err instanceof Error ? err.message : undefined })
    }
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return 'N/A'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const fileAssets = assets.filter(a => !a.isFolder)
  const folderAssets = assets.filter(a => a.isFolder)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Asset Library</h1>
          <p className="text-gray-500 text-sm mt-1">Shared creative assets — all users can contribute and browse</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={selectMode ? 'primary' : 'outline'}
            onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true) }}
          >
            {selectMode ? 'Cancel Select' : '☑ Select'}
          </Button>
          <Button variant="outline" onClick={handleDriveSync} disabled={syncing}>
            {syncing ? 'Syncing...' : '🔄 Sync Google Drive'}
          </Button>
          <Button onClick={() => setShowUpload(true)}>+ Upload Asset</Button>
        </div>
      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-blue-900">
            {selectedIds.size} asset{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowBulkTag(true)}>Tag</Button>
            <Button size="sm" variant="danger" onClick={handleBulkDelete}>Delete</Button>
            <Button size="sm" variant="outline" onClick={exitSelectMode}>Clear</Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <form onSubmit={handleSearch} className="flex items-center gap-3">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets..." className="flex-1" />
            <Select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-32">
              <option value="">All Types</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
            </Select>
            <Select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="w-40">
              <option value="">All Sources</option>
              <option value="upload">Uploaded</option>
              <option value="seedance2">Seedance2 AI</option>
              <option value="seedream">Seedream AI</option>
              <option value="gdrive">Google Drive</option>
            </Select>
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>
        </CardContent>
      </Card>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 1 && (
        <div className="flex items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-400">/</span>}
              <button
                onClick={() => navigateToBreadcrumb(i)}
                className={`hover:text-blue-600 transition-colors ${
                  i === breadcrumbs.length - 1 ? 'text-gray-900 font-medium' : 'text-gray-500'
                }`}
              >
                {i === 0 ? '🏠' : '📁'} {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Asset Grid */}
      {assets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-4xl mb-3">{currentFolderId ? '📁' : '📂'}</p>
            <p className="text-gray-500 font-medium">
              {currentFolderId ? 'This folder is empty' : 'No assets found'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {currentFolderId
                ? 'Sync from Google Drive to populate this folder'
                : 'Upload files or generate with Seedance2 to start building your library'}
            </p>
            {!currentFolderId && (
              <div className="flex gap-3 justify-center mt-4">
                <Button onClick={() => setShowUpload(true)}>Upload</Button>
                <Button variant="outline" onClick={handleDriveSync} disabled={syncing}>
                  {syncing ? 'Syncing...' : 'Sync from Drive'}
                </Button>
                <Button variant="outline" onClick={() => window.location.href = api('/seedance2')}>Generate with AI</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Folders */}
          {folderAssets.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Folders ({folderAssets.length})</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {folderAssets.map((folder) => (
                  <div
                    key={folder.id}
                    className="border rounded-lg p-4 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all bg-white text-center"
                    onClick={() => navigateToFolder(folder)}
                  >
                    <span className="text-4xl">📁</span>
                    <p className="text-sm font-medium mt-2 truncate">{folder.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {folder.source === 'gdrive' ? 'Google Drive' : folder.source}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files */}
          {fileAssets.length > 0 && (
            <div>
              {folderAssets.length > 0 && (
                <h3 className="text-sm font-medium text-gray-500 mb-2">Files ({fileAssets.length})</h3>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {fileAssets.map((a) => {
                  const isSelected = selectedIds.has(a.id)
                  return (
                  <div
                    key={a.id}
                    className={`relative border rounded-lg overflow-hidden cursor-pointer transition-all bg-white ${
                      isSelected ? 'ring-2 ring-blue-500 border-blue-500' : 'hover:shadow-md'
                    }`}
                    onClick={() => handleAssetClick(a)}
                  >
                    {selectMode && (
                      <div className="absolute top-2 left-2 z-10">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'
                        }`}>
                          {isSelected && <span className="text-white text-xs leading-none">✓</span>}
                        </div>
                      </div>
                    )}
                    <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                      {a.type === 'video' && a.thumbnailUrl ? (
                        <img src={a.thumbnailUrl} alt={a.name} className="w-full h-full object-cover" />
                      ) : a.type === 'video' && a.fileUrl ? (
                        <video src={a.fileUrl} className="w-full h-full object-cover" muted />
                      ) : a.type === 'image' && a.thumbnailUrl ? (
                        <img src={a.thumbnailUrl} alt={a.name} className="w-full h-full object-cover" />
                      ) : a.type === 'image' && a.fileUrl ? (
                        <img src={a.fileUrl} alt={a.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl">{a.type === 'video' ? '🎬' : '🖼️'}</span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium truncate">{a.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Badge variant={
                          a.source === 'seedance2' ? 'info' :
                          a.source === 'gdrive' ? 'success' :
                          a.source === 'upload' ? 'default' : 'warning'
                        }>
                          {a.source === 'gdrive' ? 'Drive' : a.source}
                        </Badge>
                        <span className="text-[10px] text-gray-400">{a.type}</span>
                        {a.fileSize && (
                          <span className="text-[10px] text-gray-400">{formatSize(a.fileSize)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bulk Tag Modal */}
      <Modal open={showBulkTag} onClose={() => setShowBulkTag(false)} title="Set Tags for Selected">
        <form onSubmit={handleBulkTag} className="space-y-4">
          <p className="text-sm text-gray-500">
            Replace tags on {selectedIds.size} asset{selectedIds.size === 1 ? '' : 's'} (comma-separated).
            Only assets you uploaded will be updated.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Tags</label>
            <Input
              value={bulkTagsInput}
              onChange={(e) => setBulkTagsInput(e.target.value)}
              placeholder="product, lifestyle, tech"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setShowBulkTag(false)}>Cancel</Button>
            <Button type="submit">Apply Tags</Button>
          </div>
        </form>
      </Modal>

      {/* Upload Modal */}
      <Modal open={showUpload} onClose={() => setShowUpload(false)} title="Upload to Asset Library">
        <form onSubmit={handleUpload} className="space-y-4">
          <p className="text-sm text-gray-500">Upload images or videos to the shared asset library. All users will be able to see and use these assets.</p>
          <div>
            <label className="block text-sm font-medium mb-1">File</label>
            <input ref={fileRef} type="file" accept="image/*,video/*" className="w-full text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name (optional)</label>
            <Input value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="Asset name" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tags (comma separated)</label>
            <Input value={uploadTags} onChange={e => setUploadTags(e.target.value)} placeholder="product, lifestyle, tech" />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button type="submit" disabled={uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
          </div>
        </form>
      </Modal>

      {/* Asset Detail Modal */}
      <Modal open={!!selectedAsset} onClose={() => setSelectedAsset(null)} title={selectedAsset?.name || 'Asset'} className="max-w-2xl">
        {selectedAsset && (
          <div className="space-y-4">
            <div className="bg-gray-900 rounded-lg overflow-hidden">
              {selectedAsset.type === 'video' && selectedAsset.fileUrl ? (
                <video src={selectedAsset.fileUrl} controls className="w-full max-h-96 object-contain" />
              ) : selectedAsset.type === 'image' && selectedAsset.fileUrl ? (
                <img src={selectedAsset.fileUrl} alt={selectedAsset.name} className="w-full max-h-96 object-contain" />
              ) : selectedAsset.thumbnailUrl ? (
                <img src={selectedAsset.thumbnailUrl} alt={selectedAsset.name} className="w-full max-h-96 object-contain" />
              ) : (
                <div className="py-12 text-center text-gray-500">No preview</div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Type</p>
                <p className="font-medium capitalize">{selectedAsset.type}</p>
              </div>
              <div>
                <p className="text-gray-500">Source</p>
                <p className="font-medium capitalize">{selectedAsset.source}</p>
              </div>
              <div>
                <p className="text-gray-500">Uploaded by</p>
                <p className="font-medium">{selectedAsset.uploaderName || 'Unknown'}</p>
              </div>
              <div>
                <p className="text-gray-500">Size</p>
                <p className="font-medium">{formatSize(selectedAsset.fileSize)}</p>
              </div>
              {selectedAsset.ratio && (
                <div>
                  <p className="text-gray-500">Ratio</p>
                  <p className="font-medium">{selectedAsset.ratio}</p>
                </div>
              )}
              {selectedAsset.duration && (
                <div>
                  <p className="text-gray-500">Duration</p>
                  <p className="font-medium">{selectedAsset.duration}s</p>
                </div>
              )}
              {selectedAsset.folderPath && (
                <div className="col-span-2">
                  <p className="text-gray-500">Path</p>
                  <p className="font-medium text-xs">{selectedAsset.folderPath}</p>
                </div>
              )}
            </div>

            {selectedAsset.prompt && (
              <div>
                <p className="text-sm text-gray-500">AI Prompt</p>
                <p className="text-sm bg-gray-50 rounded-lg p-3 mt-1">{selectedAsset.prompt}</p>
              </div>
            )}

            {selectedAsset.tags && (
              <div>
                <p className="text-sm text-gray-500 mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {(JSON.parse(selectedAsset.tags) as string[]).map((tag, i) => (
                    <Badge key={i}>{tag}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2 border-t">
              {selectedAsset.fileUrl && (
                <a href={selectedAsset.fileUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">Download / View</Button>
                </a>
              )}
              <Button variant="danger" size="sm" onClick={() => handleDelete(selectedAsset.id)}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
