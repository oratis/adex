'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs } from '@/components/ui/tabs'
import { api } from '@/lib/utils'

interface Asset {
  id: string
  name: string
  type: string
  source: string
  fileUrl: string | null
  prompt: string | null
  taskId: string | null
  status: string
  ratio: string | null
  duration: number | null
  model: string | null
  errorMessage: string | null
  uploaderName: string | null
  createdAt: string
}

interface ReferenceItem {
  type: 'image' | 'video' | 'audio'
  url: string
  label: string
  thumbnail?: string // for uploaded file preview
}

export default function Seedance2Page() {
  const [generating, setGenerating] = useState(false)
  const [assets, setAssets] = useState<Asset[]>([])
  const [pollingIds, setPollingIds] = useState<Map<string, string>>(new Map()) // assetId -> taskId
  const [taskStatuses, setTaskStatuses] = useState<Map<string, { status: string; startedAt: number }>>(new Map())
  const [refreshing, setRefreshing] = useState(false)

  // Form state
  const [mode, setMode] = useState<'text2video' | 'image2video' | 'video2video' | 'full'>('text2video')
  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(5)
  const [generateAudio, setGenerateAudio] = useState(true)
  const [references, setReferences] = useState<ReferenceItem[]>([])
  const [newRefUrl, setNewRefUrl] = useState('')
  const [newRefType, setNewRefType] = useState<'image' | 'video' | 'audio'>('image')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadAssets()
  }, [])

  // Poll for generating assets
  useEffect(() => {
    if (pollingIds.size === 0) return
    const interval = setInterval(async () => {
      for (const [assetId, taskId] of pollingIds) {
        try {
          const res = await fetch(api(`/api/seedance2/status?taskId=${taskId}&assetId=${assetId}`))
          const task = await res.json()
          // Track status for UI
          setTaskStatuses(prev => {
            const next = new Map(prev)
            const existing = prev.get(assetId)
            next.set(assetId, { status: task.status || 'queued', startedAt: existing?.startedAt || Date.now() })
            return next
          })
          if (task.status === 'succeeded' || task.status === 'failed') {
            setPollingIds(prev => {
              const next = new Map(prev)
              next.delete(assetId)
              return next
            })
            setTaskStatuses(prev => {
              const next = new Map(prev)
              next.delete(assetId)
              return next
            })
            loadAssets()
          }
        } catch { /* ignore */ }
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [pollingIds])

  // Update elapsed time display every second
  const [, setTick] = useState(0)
  useEffect(() => {
    if (pollingIds.size === 0) return
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [pollingIds.size])

  async function loadAssets() {
    setRefreshing(true)
    try {
      const res = await fetch(api('/api/assets?source=seedance2'))
      const data = await res.json()
      const items = Array.isArray(data) ? data : []
      // Only update if we got results (don't clear on error)
      if (items.length > 0 || assets.length === 0) {
        setAssets(items)
      }

      // Auto-poll generating assets (merge with existing polling)
      const newPolling = new Map<string, string>()
      for (const a of items) {
        if (a.status === 'generating' && a.taskId) {
          newPolling.set(a.id, a.taskId)
          // Track start time if not already tracked
          setTaskStatuses(prev => {
            if (prev.has(a.id)) return prev
            const next = new Map(prev)
            next.set(a.id, { status: 'queued', startedAt: new Date(a.createdAt).getTime() })
            return next
          })
        }
      }
      if (newPolling.size > 0) {
        setPollingIds(prev => {
          const merged = new Map(prev)
          for (const [k, v] of newPolling) merged.set(k, v)
          return merged
        })
      }
    } catch {
      // Don't clear assets on fetch failure
    } finally {
      setRefreshing(false)
    }
  }

  function addReference() {
    if (!newRefUrl.trim()) return
    setReferences(prev => [...prev, { type: newRefType, url: newRefUrl.trim(), label: `${newRefType} ${prev.length + 1}` }])
    setNewRefUrl('')
  }

  function removeReference(idx: number) {
    setReferences(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', file.name)
      const res = await fetch(api('/api/assets'), { method: 'POST', body: formData })
      const asset = await res.json()
      if (asset.error) {
        alert(asset.error)
        return
      }
      // fileUrl is now a full GCS URL (https://storage.googleapis.com/...)
      const fullUrl = asset.fileUrl
      const fileType: 'image' | 'video' | 'audio' = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image'
      setReferences(prev => [...prev, {
        type: fileType,
        url: fullUrl,
        label: file.name,
        thumbnail: fileType === 'image' ? fullUrl : undefined,
      }])
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!prompt.trim()) return
    setGenerating(true)

    try {
      const refImages = references.filter(r => r.type === 'image').map(r => r.url)
      const refVideos = references.filter(r => r.type === 'video').map(r => r.url)
      const refAudios = references.filter(r => r.type === 'audio').map(r => r.url)

      const res = await fetch(api('/api/seedance2/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || undefined,
          prompt,
          mode,
          referenceImages: refImages.length > 0 ? refImages : undefined,
          referenceVideos: refVideos.length > 0 ? refVideos : undefined,
          referenceAudios: refAudios.length > 0 ? refAudios : undefined,
          generateAudio,
          ratio,
          duration,
        }),
      })

      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        // Start polling
        if (data.asset?.id && data.task?.id) {
          setPollingIds(prev => new Map(prev).set(data.asset.id, data.task.id))
          setTaskStatuses(prev => {
            const next = new Map(prev)
            next.set(data.asset.id, { status: 'queued', startedAt: Date.now() })
            return next
          })
        }
        setPrompt('')
        setName('')
        setReferences([])
        loadAssets()
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const statusVariant = (s: string) => {
    switch (s) {
      case 'ready': return 'success' as const
      case 'generating': return 'warning' as const
      case 'failed': return 'danger' as const
      default: return 'default' as const
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Seedance2 Studio</h1>
        <p className="text-gray-500 text-sm mt-1">AI video generation for ad creatives — powered by doubao-seedance-2-0</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Generation Panel */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generate Video</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleGenerate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Generation Mode</label>
                  <Select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
                    <option value="text2video">Text → Video</option>
                    <option value="image2video">Image → Video</option>
                    <option value="video2video">Video → Video</option>
                    <option value="full">Full Creative (Text + Images + Video + Audio)</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Name (optional)</label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ad creative name" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Prompt *</label>
                  <textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    rows={5}
                    placeholder="Describe the video you want to generate. Be specific about scenes, transitions, camera angles, and audio..."
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Ratio</label>
                    <Select value={ratio} onChange={e => setRatio(e.target.value)}>
                      <option value="16:9">16:9 (Landscape)</option>
                      <option value="9:16">9:16 (Portrait/TikTok)</option>
                      <option value="1:1">1:1 (Square)</option>
                      <option value="4:3">4:3</option>
                      <option value="3:4">3:4</option>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Duration (s)</label>
                    <Input type="number" value={duration} onChange={e => setDuration(+e.target.value)} min={1} max={30} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="genAudio"
                    checked={generateAudio}
                    onChange={e => setGenerateAudio(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="genAudio" className="text-sm">Generate audio / voiceover</label>
                </div>

                {/* Reference Materials */}
                {mode !== 'text2video' && (
                  <div className="border-t pt-3">
                    <label className="block text-sm font-medium mb-2">Reference Materials</label>
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={newRefType === 'image' ? 'image/*' : newRefType === 'video' ? 'video/*' : 'audio/*'}
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    {/* Upload button */}
                    <div className="flex gap-2 mb-2">
                      <Select value={newRefType} onChange={e => setNewRefType(e.target.value as 'image' | 'video' | 'audio')} className="w-24">
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                        <option value="audio">Audio</option>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {uploading ? 'Uploading...' : `Upload ${newRefType}`}
                      </Button>
                    </div>
                    {/* URL input as alternative */}
                    <div className="flex gap-2 mb-2">
                      <Input
                        value={newRefUrl}
                        onChange={e => setNewRefUrl(e.target.value)}
                        placeholder="Or paste URL..."
                        className="flex-1"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addReference() } }}
                      />
                      <Button type="button" size="sm" variant="outline" onClick={addReference}>+</Button>
                    </div>
                    {references.length > 0 && (
                      <div className="space-y-1.5">
                        {references.map((ref, i) => (
                          <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1.5 text-xs">
                            {ref.thumbnail && (
                              <img src={ref.thumbnail} alt="" className="w-10 h-10 object-cover rounded" />
                            )}
                            <Badge variant={ref.type === 'image' ? 'info' : ref.type === 'video' ? 'success' : 'warning'}>
                              {ref.type}
                            </Badge>
                            <span className="flex-1 truncate">{ref.label || ref.url}</span>
                            <button type="button" onClick={() => removeReference(i)} className="text-red-400 hover:text-red-600">&times;</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={generating || !prompt.trim()}>
                  {generating ? 'Submitting...' : 'Generate Video'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Generated Videos</CardTitle>
                <Button size="sm" variant="outline" onClick={loadAssets} disabled={refreshing}>
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {assets.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <p className="text-4xl mb-3">🎬</p>
                  <p className="font-medium">No videos generated yet</p>
                  <p className="text-sm mt-1">Use the form to create your first AI ad video</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {assets.map((a) => (
                    <div key={a.id} className="border rounded-lg overflow-hidden">
                      <div className="aspect-video bg-gray-900 flex items-center justify-center relative">
                        {a.status === 'ready' && a.fileUrl ? (
                          <video src={a.fileUrl} controls className="w-full h-full object-contain" />
                        ) : a.status === 'generating' ? (
                          (() => {
                            const taskInfo = taskStatuses.get(a.id)
                            const elapsed = taskInfo ? Math.floor((Date.now() - taskInfo.startedAt) / 1000) : 0
                            const minutes = Math.floor(elapsed / 60)
                            const seconds = elapsed % 60
                            const statusLabel = taskInfo?.status === 'running' ? 'Rendering' : taskInfo?.status === 'queued' ? 'Queued' : 'Generating'
                            return (
                              <div className="text-center text-white w-full px-6">
                                <div className="relative w-full h-1.5 bg-gray-700 rounded-full mb-3 overflow-hidden">
                                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 animate-pulse rounded-full" style={{ animation: 'shimmer 2s ease-in-out infinite' }} />
                                </div>
                                <p className="text-sm font-medium">{statusLabel}...</p>
                                <p className="text-xs text-gray-400 mt-1">
                                  {minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`} elapsed
                                </p>
                              </div>
                            )
                          })()
                        ) : a.status === 'failed' ? (
                          <div className="text-center text-red-400 px-4">
                            <p className="text-3xl mb-2">&#x274C;</p>
                            <p className="text-sm">{a.errorMessage || 'Failed'}</p>
                          </div>
                        ) : (
                          <div className="text-gray-500 text-sm">Pending</div>
                        )}
                        <div className="absolute top-2 right-2">
                          <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="font-medium text-sm truncate">{a.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {a.ratio} · {a.duration}s · by {a.uploaderName}
                        </p>
                        {a.prompt && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{a.prompt}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
