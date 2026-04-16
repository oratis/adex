'use client'

import { useEffect, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import { Tabs } from '@/components/ui/tabs'
import { api } from '@/lib/utils'

interface Creative {
  id: string
  name: string
  type: string
  source: string
  filePath: string | null
  fileUrl: string | null
  prompt: string | null
  status: string
  width: number | null
  height: number | null
  createdAt: string
}

export default function CreativesPage() {
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [aiForm, setAiForm] = useState({
    name: '', type: 'image', prompt: '', width: 1080, height: 1080, style: '',
  })

  useEffect(() => {
    loadCreatives()
  }, [])

  async function loadCreatives() {
    const res = await fetch(api('/api/creatives'))
    const data = await res.json()
    setCreatives(Array.isArray(data) ? data : [])
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', file.name)
      await fetch(api('/api/creatives'), { method: 'POST', body: formData })
      setShowCreate(false)
      loadCreatives()
    } finally {
      setUploading(false)
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setGenerating(true)
    try {
      // First create the creative record
      const res = await fetch(api('/api/creatives'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: aiForm.name,
          type: aiForm.type,
          source: aiForm.type === 'video' ? 'seedance' : 'seedream',
          prompt: aiForm.prompt,
          width: aiForm.width,
          height: aiForm.height,
        }),
      })
      const creative = await res.json()

      // Then trigger generation
      await fetch(api('/api/creatives/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creativeId: creative.id,
          type: aiForm.type,
          prompt: aiForm.prompt,
          width: aiForm.width,
          height: aiForm.height,
          style: aiForm.style,
        }),
      })

      setShowCreate(false)
      setAiForm({ name: '', type: 'image', prompt: '', width: 1080, height: 1080, style: '' })
      loadCreatives()
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Creatives</h1>
          <p className="text-gray-500 text-sm mt-1">Manage ad creatives - upload or generate with AI</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ New Creative</Button>
      </div>

      {creatives.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">No creatives yet. Upload files or generate with AI.</p>
            <p className="text-sm text-gray-400 mt-2">Put files in the <code className="bg-gray-100 px-1 rounded">public/uploads</code> folder, or use the AI generator.</p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>Add Creative</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {creatives.map((c) => (
            <Card key={c.id}>
              <div className="aspect-video bg-gray-100 rounded-t-xl flex items-center justify-center overflow-hidden">
                {c.fileUrl ? (
                  c.type === 'video' ? (
                    <video src={c.fileUrl} className="w-full h-full object-cover" />
                  ) : (
                    <img src={c.fileUrl} alt={c.name} className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="text-center p-4">
                    <p className="text-3xl">{c.type === 'video' ? '🎬' : '🖼️'}</p>
                    <p className="text-sm text-gray-400 mt-2">{c.status === 'generating' ? 'Generating...' : 'No preview'}</p>
                  </div>
                )}
              </div>
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm truncate">{c.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{c.source} &middot; {c.type}</p>
                  </div>
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </div>
                {c.prompt && (
                  <p className="text-xs text-gray-400 mt-2 line-clamp-2">{c.prompt}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Creative" className="max-w-xl">
        <Tabs tabs={[
          {
            id: 'upload',
            label: 'Upload File',
            content: (
              <form onSubmit={handleUpload} className="space-y-4">
                <p className="text-sm text-gray-500">Upload an image or video from your computer, or place files in the <code className="bg-gray-100 px-1 rounded">public/uploads</code> folder.</p>
                <div>
                  <label className="block text-sm font-medium mb-1">Select File</label>
                  <input ref={fileRef} type="file" accept="image/*,video/*" className="w-full text-sm" required />
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button type="submit" disabled={uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
                </div>
              </form>
            ),
          },
          {
            id: 'ai',
            label: 'AI Generate',
            content: (
              <form onSubmit={handleGenerate} className="space-y-4">
                <p className="text-sm text-gray-500">Generate creatives using Seedream (images) or Seedance (videos). Configure API keys in Settings first.</p>
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <Input value={aiForm.name} onChange={e => setAiForm(f => ({ ...f, name: e.target.value }))} placeholder="Ad creative name" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <Select value={aiForm.type} onChange={e => setAiForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="image">Image (Seedream)</option>
                    <option value="video">Video (Seedance)</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Prompt</label>
                  <textarea
                    value={aiForm.prompt}
                    onChange={e => setAiForm(f => ({ ...f, prompt: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    rows={3}
                    placeholder="Describe the ad creative you want to generate..."
                    required
                  />
                </div>
                {aiForm.type === 'image' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Width</label>
                      <Input type="number" value={aiForm.width} onChange={e => setAiForm(f => ({ ...f, width: +e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Height</label>
                      <Input type="number" value={aiForm.height} onChange={e => setAiForm(f => ({ ...f, height: +e.target.value }))} />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Style (optional)</label>
                  <Input value={aiForm.style} onChange={e => setAiForm(f => ({ ...f, style: e.target.value }))} placeholder="e.g., photorealistic, cartoon, minimalist" />
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button type="submit" disabled={generating}>{generating ? 'Generating...' : 'Generate'}</Button>
                </div>
              </form>
            ),
          },
        ]} />
      </Modal>
    </div>
  )
}
