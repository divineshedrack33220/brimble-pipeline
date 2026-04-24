import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { 
  Rocket, 
  GitBranch, 
  Terminal, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Clock,
  ExternalLink,
  Trash2,
  RefreshCw
} from 'lucide-react'

const API = axios.create({ baseURL: 'http://localhost:3000/api' })

interface Deployment {
  id: string
  status: 'pending' | 'building' | 'deploying' | 'running' | 'failed'
  git_url: string
  image_tag: string
  url: string
  created_at: string
  logs?: string
}

function App() {
  const [gitUrl, setGitUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ message: string; level: string }[]>([])
  const queryClient = useQueryClient()

  const { data: deployments = [], refetch, isLoading } = useQuery<Deployment[]>({
    queryKey: ['deployments'],
    queryFn: async () => {
      const { data } = await API.get('/deployments')
      return data
    },
    refetchInterval: 3000
  })

  const createMutation = useMutation({
    mutationFn: async ({ gitUrl, branch }: { gitUrl: string; branch: string }) => {
      const { data } = await API.post('/deployments', { gitUrl, branch })
      return data
    },
    onSuccess: () => {
      refetch()
      setGitUrl('')
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await API.delete(`/deployments/${id}`)
    },
    onSuccess: () => {
      refetch()
      if (selectedDeployment) setSelectedDeployment(null)
    }
  })

  useEffect(() => {
    if (!selectedDeployment) return
    
    const eventSource = new EventSource(`http://localhost:3000/api/deployments/${selectedDeployment}/logs`)
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setLogs(prev => [...prev, { message: data.message, level: data.level }])
    }
    
    eventSource.onerror = () => {
      eventSource.close()
    }
    
    return () => {
      eventSource.close()
      setLogs([])
    }
  }, [selectedDeployment])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />
      case 'building': return <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
      case 'deploying': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
      default: return <Clock className="w-4 h-4 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-green-500 bg-green-500/10'
      case 'failed': return 'text-red-500 bg-red-500/10'
      case 'building': return 'text-yellow-500 bg-yellow-500/10'
      case 'deploying': return 'text-blue-500 bg-blue-500/10'
      default: return 'text-gray-500 bg-gray-500/10'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="border-b border-gray-700 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg">
                <Rocket className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Brimble Pipeline
                </h1>
                <p className="text-xs text-gray-400">Ultimate deployment platform</p>
              </div>
            </div>
            <button
              onClick={() => refetch()}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Deploy Form */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700 p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Rocket className="w-5 h-5 text-purple-400" />
            New Deployment
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Git Repository URL
              </label>
              <input
                type="text"
                placeholder="https://github.com/user/repo.git"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Branch
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                <button
                  onClick={() => createMutation.mutate({ gitUrl, branch })}
                  disabled={!gitUrl || createMutation.isPending}
                  className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-all flex items-center gap-2"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deploying...
                    </>
                  ) : (
                    <>
                      <Rocket className="w-4 h-4" />
                      Deploy
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Deployments List */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Deployments</h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            </div>
          ) : deployments.length === 0 ? (
            <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700">
              <Terminal className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No deployments yet</p>
              <p className="text-sm text-gray-500">Deploy your first app using the form above</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {deployments.map((deploy) => (
                <div
                  key={deploy.id}
                  className={`bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700 p-4 transition-all hover:border-gray-600 ${
                    selectedDeployment === deploy.id ? 'ring-2 ring-purple-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`px-2 py-1 rounded-lg flex items-center gap-1.5 text-xs font-medium ${getStatusColor(deploy.status)}`}>
                        {getStatusIcon(deploy.status)}
                        <span className="capitalize">{deploy.status}</span>
                      </div>
                      <code className="text-xs bg-gray-900 px-2 py-1 rounded font-mono">
                        {deploy.id.slice(0, 8)}
                      </code>
                      {deploy.image_tag && (
                        <span className="text-xs text-gray-400 font-mono">
                          {deploy.image_tag.split(':')[1]?.slice(0, 12)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {deploy.url && (
                        <a
                          href={deploy.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        onClick={() => setSelectedDeployment(deploy.id)}
                        className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <Terminal className="w-3 h-3" />
                        Logs
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(deploy.id)}
                        className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logs Drawer */}
        {selectedDeployment && (
          <div className="fixed inset-y-0 right-0 w-full md:w-2/3 lg:w-1/2 bg-gray-900 border-l border-gray-700 shadow-xl z-50 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-purple-400" />
                <h3 className="font-semibold">Deployment Logs</h3>
                <code className="text-xs bg-gray-700 px-2 py-1 rounded font-mono">
                  {selectedDeployment.slice(0, 8)}
                </code>
              </div>
              <button
                onClick={() => setSelectedDeployment(null)}
                className="p-1 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-gray-500 text-center py-8">Waiting for logs...</div>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    className={`mb-1 ${
                      log.level === 'error' ? 'text-red-400' :
                      log.level === 'success' ? 'text-green-400' :
                      log.level === 'warn' ? 'text-yellow-400' :
                      'text-gray-300'
                    }`}
                  >
                    <span className="text-gray-500 mr-2">
                      {new Date().toLocaleTimeString()}
                    </span>
                    {log.message}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
