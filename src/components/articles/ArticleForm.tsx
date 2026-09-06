'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sparkles, Save, Send, Calendar, Loader2, Globe, Search, FolderOpen,
  ExternalLink, Check, CheckCircle2, ChevronDown, ChevronUp, AlertCircle, Plus, ImageUp, Zap,
  ClipboardList, BookMarked,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import ConfirmSiteModal from '@/components/ui/ConfirmSiteModal'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import ArticleEditor from '@/components/articles/ArticleEditor'
import ModelSelect, { LAST_MODEL_KEY } from '@/components/ui/ModelSelect'

const SEO_LAST_MODEL_KEY = 'zaoflo_last_model_seo'
import ImageGenerator from '@/components/articles/ImageGenerator'
import CollabPanel from '@/components/collab/CollabPanel'
import IdeaGenerator from '@/components/articles/IdeaGenerator'
import ScheduleCalendarModal from '@/components/ui/ScheduleCalendarModal'
import { formatInZone } from '@/lib/timezone'
import { useUnsavedWarning } from '@/lib/use-unsaved-warning'
import InstructionSets from '@/components/articles/InstructionSets'
import SiteKnowledgeBase from '@/components/articles/SiteKnowledgeBase'
import CostReceipt from '@/components/articles/CostReceipt'
import type { UsageRecord } from '@/lib/ai-cost'
import type { Article, Site, ArticleInstruction } from '@/types'
import toast from 'react-hot-toast'

interface WPCategory { id: number; name: string; count: number }

type PublishMode = 'draft' | 'now' | 'scheduled'

// The site and the category are picked once and then just read, so in the
// header they are labels you can click rather than two selects stretched the
// width of the page. The picking itself happens in a modal.
const PICKER_BUTTON =
  'flex items-center gap-2 max-w-[15rem] px-3 py-1.5 rounded-lg border border-gray-200 ' +
  'dark:border-gray-700 bg-white dark:bg-gray-800 text-left transition-colors ' +
  'hover:border-brand-300 dark:hover:border-brand-700 disabled:opacity-60 disabled:hover:border-gray-200 ' +
  'dark:disabled:hover:border-gray-700'

const PICKER_ROW =
  'w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm text-left ' +
  'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors'

// Consistent outlined pill shape shared by every metadata and action button in
// the sticky header. Sized so a completed-step chip and a Save button read as
// the same visual weight — the three sections are told apart by colour, not by
// size.
const PILL_BASE =
  'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-medium ' +
  'transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed'
const PILL_NEUTRAL =
  'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400'
const PILL_GREEN =
  'border-green-200 dark:border-green-900/50 bg-green-50/60 dark:bg-green-900/15 ' +
  'text-green-700 dark:text-green-400'
const PILL_PURPLE =
  'border-brand-200 dark:border-brand-900/50 bg-brand-50/60 dark:bg-brand-900/15 ' +
  'text-brand-700 dark:text-brand-400 hover:border-brand-400 dark:hover:border-brand-600'
const PILL_AMBER =
  'border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/15 ' +
  'text-amber-700 dark:text-amber-400'
const PILL_ACTION =
  'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 ' +
  'hover:bg-gray-50 dark:hover:bg-gray-700'
const PILL_ACTION_ACTIVE =
  'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
const PILL_PRIMARY =
  'border-brand-600 bg-brand-600 text-white hover:bg-brand-700 hover:border-brand-700'
const ICON_BUTTON =
  'relative flex items-center justify-center w-11 h-11 shrink-0 rounded-full border ' +
  'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 ' +
  'hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-brand-600 dark:hover:text-brand-400 ' +
  'transition-colors'

interface Props {
  /** Present when editing an existing article; absent when composing a new one. */
  articleId?: string
  /** An idea being taken back out of Archive → Ideas and written up. */
  ideaId?: string | null
}

/**
 * The one article screen. `/articles/new` composes a new article and
 * `/articles/<id>` loads an existing one into exactly the same form, so an
 * article is edited with every tool it was created with — the image
 * generator, the SEO fields, the instructions and the scheduler.
 */
export default function ArticleForm({ articleId, ideaId }: Props) {
  const router = useRouter()
  const editId = articleId ?? null
  const isEdit = !!editId
  const [loadingArticle, setLoadingArticle] = useState(!!editId)
  const [notFound, setNotFound] = useState(false)
  // The saved row, kept for the things the form does not edit: status, the
  // WordPress permalink, the word count.
  const [saved, setSaved] = useState<Article | null>(null)
  // The category list arrives after the article does, and the effect that loads
  // it clears the selection — park the saved category here until it can land.
  const pendingCategoryRef = useRef<number | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  // Filled by an accepted idea or a loaded article. Reaches the generator
  // and the SEO fields; no manual entry surface on the form.
  const [keywords, setKeywords] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [seoModel, setSeoModel] = useState('')

  // The model each picker opens on. Most-used wins — the model the user has
  // run the most times for that step — with localStorage last-used as an
  // immediate fallback while the fetch is in flight, and as a stand-in for
  // users with no usage history yet.
  const [preferredModels, setPreferredModels] = useState<Record<string, string>>({})
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_MODEL_KEY)
      if (saved) setModel(saved)
    } catch {}
    try {
      const savedSeo = localStorage.getItem(SEO_LAST_MODEL_KEY)
      if (savedSeo) setSeoModel(savedSeo)
    } catch {}

    // Loading an existing article skips the preference lookup — that row's
    // ai_model is what should be shown, and it lands via the edit-mode fetch.
    if (editId) return
    fetch('/api/preferences/models')
      .then((r) => r.json())
      .then((d) => {
        const m: Record<string, string> = d?.models || {}
        setPreferredModels(m)
        if (m.article) setModel(m.article)
        if (m.seo) setSeoModel(m.seo)
      })
      .catch(() => {})
  }, [editId])
  const [instructions, setInstructions] = useState('')
  const [instructionSetId, setInstructionSetId] = useState<string | null>(null)
  const [wpCategoryId, setWpCategoryId] = useState<number | ''>('')
  const [categories, setCategories] = useState<WPCategory[]>([])
  const [loadingCats, setLoadingCats] = useState(false)
  const [showSitePicker, setShowSitePicker] = useState(false)
  // Asked before every generation: the site is chosen once at the top and then
  // not looked at again, and writing for the wrong one is only discovered
  // after it has been paid for.
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  // The site the user has already confirmed in this workflow session. Once
  // said "yes" to on any of the AI actions (idea generation or article
  // generation), we do not ask again for the same site — it stays valid
  // until they switch site, at which point we ask afresh.
  const [siteConfirmedFor, setSiteConfirmedFor] = useState<string | null>(null)
  useEffect(() => { setSiteConfirmedFor(null) }, [siteId])
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [categoryQuery, setCategoryQuery] = useState('')
  const [publishMode, setPublishMode] = useState<PublishMode>('draft')
  const [scheduledAt, setScheduledAt] = useState('')
  const [scheduledTz, setScheduledTz] = useState('PST')
  const [showScheduler, setShowScheduler] = useState(false)
  // A generated article is thousands of words tall, which buried the SEO fields
  // under it. The body opens on demand instead of by default.
  const [contentExpanded, setContentExpanded] = useState(false)
  // The slot that is actually written to the database and sitting on WordPress.
  // Distinct from `scheduledAt`, which is only what the form is showing.
  const [committedSlot, setCommittedSlot] = useState<string | null>(null)
  // Cost rows for every generation on this article, claimed when it saves.
  const [usageIds, setUsageIds] = useState<string[]>([])
  const [receipt, setReceipt] = useState<UsageRecord[]>([])
  const [showInstructions, setShowInstructions] = useState(false)
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false)
  // Set once the article has actually been written, so leaving afterwards is
  // silent rather than nagging.
  const [savedOnce, setSavedOnce] = useState(false)
  // The row autosave created for a new article. From then on this form is
  // bound to that row, so an explicit Save updates it instead of inserting a
  // second copy of the same article.
  const [autoCreatedId, setAutoCreatedId] = useState<string | null>(null)
  const [autosaving, setAutosaving] = useState(false)
  const [autosavedAt, setAutosavedAt] = useState<Date | null>(null)
  const [autosaveError, setAutosaveError] = useState<string | null>(null)
  // Guards against a second autosave starting while one is still in flight.
  const autosaveInFlight = useRef(false)

  function collectUsage(ids?: string[] | string | null) {
    const list = Array.isArray(ids) ? ids : ids ? [ids] : []
    if (list.length) setUsageIds((prev) => [...prev, ...list])
  }

  function pushReceipt(records?: UsageRecord[] | null) {
    if (!records?.length) return
    setReceipt((prev) => {
      // Endpoints return records fresh after insert, but on edit-load the same
      // rows come back from GET. Guard against showing a call twice.
      const seen = new Set(prev.map((r) => r.id))
      const additions = records.filter((r) => r && r.id && !seen.has(r.id))
      return additions.length ? [...prev, ...additions] : prev
    })
  }
  // The body an accepted idea leaves behind, so a one-line brief sitting in
  // the editor is not mistaken for a written article. Cleared the moment
  // something replaces it.
  const [ideaSeed, setIdeaSeed] = useState<string | null>(null)
  const [pushingImage, setPushingImage] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingSEO, setGeneratingSEO] = useState(false)
  // The article row that is currently being written by a Trigger.dev task.
  // Set when the /api/generate handoff succeeds or when an edit-mode load
  // finds a row already in 'generating' — kept until the row transitions
  // out of that status, at which point the form hydrates from the results.
  const [generatingArticleId, setGeneratingArticleId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // SEO fields (auto-filled after generation, editable)
  const [focusKeyphrase, setFocusKeyphrase] = useState('')
  const [keyphraseSynonyms, setKeyphraseSynonyms] = useState('')
  const [yoastTitle, setYoastTitle] = useState('')
  const [yoastMetaDescription, setYoastMetaDescription] = useState('')
  const [slug, setSlug] = useState('')

  // Featured image
  const [featuredImageUrl, setFeaturedImageUrl] = useState('')
  const [featuredImagePrompt, setFeaturedImagePrompt] = useState('')
  const [featuredImageAlt, setFeaturedImageAlt] = useState('')

  // The category list is the last thing to land, so the clean snapshot below
  // waits for it — otherwise the article would look edited the moment its own
  // saved category arrived.
  const [catsSettled, setCatsSettled] = useState(!editId)
  // The form exactly as it was last written to the database; null until taken.
  const [cleanSnapshot, setCleanSnapshot] = useState<string | null>(null)

  const formSnapshot = JSON.stringify([
    siteId, title, content, keywords, instructions, wpCategoryId,
    focusKeyphrase, keyphraseSynonyms, yoastTitle, yoastMetaDescription, slug,
    featuredImageUrl, featuredImagePrompt, featuredImageAlt,
    publishMode, scheduledAt, scheduledTz,
  ])

  useEffect(() => {
    if (loadingArticle || loadingCats || !catsSettled) return
    if (cleanSnapshot === null) setCleanSnapshot(formSnapshot)
  }, [loadingArticle, loadingCats, catsSettled, cleanSnapshot, formSnapshot])

  // The row this form writes to: the one it was opened on, or the one autosave
  // created along the way. Null only until a new article first reaches disk.
  const boundId = editId ?? autoCreatedId
  const isPersisted = boundId !== null

  // The site the article is being written for — its knowledge base is what the
  // AI reads before writing anything for it.
  const selectedSite = sites.find((s) => s.id === siteId) || null
  // Node.js sites have no WordPress-style category taxonomy, and no native
  // future-post scheduling — they only ever publish immediately.
  const isNodeSite = selectedSite?.site_type === 'nodejs'
  const selectedCategory = categories.find((c) => c.id === wpCategoryId) || null
  const visibleCategories = categoryQuery.trim()
    ? categories.filter((c) =>
        c.name.toLowerCase().includes(categoryQuery.trim().toLowerCase()))
    : categories

  // A loaded article is only "unsaved work" once something actually changes;
  // a new one counts the moment there is anything to lose.
  const hasUnsavedWork = isPersisted
    ? cleanSnapshot !== null && formSnapshot !== cleanSnapshot
    : !savedOnce &&
      (title.trim().length > 0 ||
        content.replace(/<[^>]*>/g, '').trim().length > 0 ||
        !!scheduledAt)

  useUnsavedWarning(
    hasUnsavedWork,
    isEdit
      ? 'This article has changes you have not saved. Leave and lose them?'
      : 'This article has not been saved yet. Leave and lose it?'
  )

  useEffect(() => {
    fetch('/api/sites').then((r) => r.json()).then((d) => {
      setSites(d.sites || [])
      // In edit mode the article supplies the site; defaulting here would
      // silently move the article to whichever site happens to sort first.
      if (d.sites?.length > 0 && !editId) setSiteId(d.sites[0].id)
    })
  }, [editId])

  // An idea restored from the archive. Held until the sites are in, because
  // the idea names the site it was written for and that has to land after the
  // default-to-the-first-site above rather than before it.
  const restoredIdeaRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ideaId || editId || !sites.length) return
    if (restoredIdeaRef.current === ideaId) return
    restoredIdeaRef.current = ideaId

    ;(async () => {
      try {
        const res = await fetch(`/api/ideas/archive/${ideaId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not open that idea')

        const idea = data.idea
        // A site can be disconnected between filing an idea and using it. The
        // idea is still worth writing; it just does not get to pick the site.
        if (sites.some((site) => site.id === idea.site_id)) setSiteId(idea.site_id)
        applyIdea({
          title: idea.title,
          description: idea.description || '',
          keywords: idea.keywords || [],
          usageId: idea.usage_id,
        })

        // Out of the archive now that it is being written. Best-effort: an
        // idea that is on screen but still filed is a duplicate, not a loss.
        fetch(`/api/ideas/archive/${ideaId}`, { method: 'DELETE' }).catch(() => {})

        // Drop the query without a navigation, so a refresh does not go looking
        // for an idea that is no longer in the archive — and so nothing in this
        // half-filled form is remounted out from under you.
        window.history.replaceState({}, '', '/articles/new')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not open that idea')
      }
    })()
    // applyIdea is rebuilt every render; the ref above is what keeps this to one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideaId, editId, sites])

  // Edit mode: pull the article in and prefill every field.
  useEffect(() => {
    if (!editId) return
    let cancelled = false
    fetch(`/api/articles/${editId}`)
      .then((r) => r.json())
      .then((d) => {
        const a = d.article
        if (cancelled) return
        if (!a) { setNotFound(true); return }
        setSaved(a)
        pushReceipt(d.usage)
        setSiteId(a.site_id || '')
        setTitle(a.title || '')
        setContent(a.content || '')
        setKeywords(a.keywords || [])
        setIdeaSeed(null)
        if (a.ai_model) setModel(a.ai_model)
        setFocusKeyphrase(a.focus_keyphrase || '')
        setKeyphraseSynonyms(a.keyphrase_synonyms || '')
        setYoastTitle(a.yoast_title || '')
        setYoastMetaDescription(a.yoast_meta_description || '')
        setSlug(a.slug || '')
        setFeaturedImageUrl(a.featured_image_url || '')
        setFeaturedImagePrompt(a.featured_image_prompt || '')
        // Loaded, not left empty: the save writes this field back, so an alt
        // the form never read would be wiped by the next save of the article.
        setFeaturedImageAlt(a.featured_image_alt || '')
        if (a.wp_category_id) pendingCategoryRef.current = a.wp_category_id
        if (a.scheduled_at) {
          setPublishMode('scheduled')
          setScheduledAt(a.scheduled_at)
          setScheduledTz(a.scheduled_tz || 'PST')
          // Loaded from the row, so it is committed by definition.
          if (a.status === 'scheduled') setCommittedSlot(a.scheduled_at)
        }
        // An article whose body is still being written on the server keeps
        // running whether or not the tab is open. Pick the poll back up so
        // the form hydrates the moment the task lands.
        if (a.status === 'generating') {
          setGenerating(true)
          setGeneratingArticleId(a.id)
        }
      })
      .catch(() => { if (!cancelled) { setNotFound(true); toast.error('Could not load the article') } })
      .finally(() => { if (!cancelled) setLoadingArticle(false) })
    return () => { cancelled = true }
  }, [editId])

  // Poll the row while a Trigger.dev task is writing to it. Kept simple —
  // one request every few seconds is plenty when the underlying write takes
  // 30–90s. When the row lands as anything other than 'generating' we
  // hydrate whatever fields the task produced.
  useEffect(() => {
    if (!generatingArticleId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/articles/${generatingArticleId}`)
        const data = await res.json()
        if (cancelled) return
        const a = data.article
        if (!a) return
        if (a.status === 'generating') {
          timer = setTimeout(poll, 4000)
          return
        }
        // Hydrate everything the task might have written. Left alone: title,
        // keywords, site_id — those came from the form and the task is not
        // supposed to overwrite them.
        setContent(a.content || '')
        setIdeaSeed(null)
        if (a.ai_model) setModel(a.ai_model)
        setFocusKeyphrase(a.focus_keyphrase || '')
        setKeyphraseSynonyms(a.keyphrase_synonyms || '')
        setYoastTitle(a.yoast_title || '')
        setYoastMetaDescription(a.yoast_meta_description || '')
        setSlug(a.slug || '')
        setSaved(a)
        pushReceipt(data.usage)
        setGeneratingArticleId(null)
        setGenerating(false)
        toast.success('Article + SEO fields generated!')
      } catch {
        // A transient failure just tries again a bit later — the task is
        // still running on the server regardless.
        if (!cancelled) timer = setTimeout(poll, 6000)
      }
    }

    timer = setTimeout(poll, 2000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatingArticleId])

  useEffect(() => {
    if (!siteId || isNodeSite) { setCatsSettled(true); setCategories([]); setWpCategoryId(''); return }
    setLoadingCats(true)
    setCategories([])
    // Categories are per-site, so a selection from the previous site is stale
    setWpCategoryId('')
    fetch(`/api/sites/${siteId}/categories`)
      .then((r) => r.json())
      .then((d) => {
        const cats: WPCategory[] = d.categories || []
        setCategories(cats)
        // Preselect what this site is actually being written for: the category
        // the last articles here went to, which is a better guess than the one
        // WordPress happens to hold the most posts in. Falls back to that
        // lifetime count, and to Uncategorized on a site with neither.
        const suggested: number | null = d.suggested_id ?? null
        const mostUsed = cats.reduce<WPCategory | null>(
          (best, c) => (best === null || c.count > best.count ? c : best),
          null
        )
        if (pendingCategoryRef.current !== null) {
          setWpCategoryId(pendingCategoryRef.current)
          pendingCategoryRef.current = null
        } else if (suggested !== null) {
          setWpCategoryId(suggested)
        } else if (mostUsed && mostUsed.count > 0) {
          setWpCategoryId(mostUsed.id)
        }
      })
      .catch(() => {})
      .finally(() => { setLoadingCats(false); setCatsSettled(true) })
  }, [siteId, isNodeSite])

  // An accepted idea seeds the article: the title has to land in the title
  // field or "Generate with AI" has nothing to work from, and the description
  // becomes the opening brief in the editor.
  function applyIdea(idea: {
    title: string
    description: string
    keywords: string[]
    usageId?: string | null
    receipt?: UsageRecord[] | null
  }) {
    const hasContent = content.replace(/<[^>]*>/g, '').trim().length > 0
    if (hasContent && !confirm('Replace what you have written with this idea?')) return

    const seeded = `<p>${idea.description}</p>`
    setTitle(idea.title)
    setContent(seeded)
    setIdeaSeed(seeded)
    collectUsage(idea.usageId)
    pushReceipt(idea.receipt)
    if (idea.keywords?.length && keywords.length === 0) setKeywords(idea.keywords)
    toast.success('Idea applied — hit Generate with AI to write it')
  }

  // Picking a set is the only way instructions reach this article — there is no
  // free-text box, so the article always carries the wording of a saved set.
  function handleSelectInstructionSet(set: ArticleInstruction) {
    setInstructions(set.instructions)
    setInstructionSetId(set.id)
  }

  async function handleGenerate() {
    if (!title.trim()) { toast.error('Enter a title before generating'); return }
    // The site is what carries the knowledge base, and that is read into every
    // article prompt — so there is no generating before one is picked.
    if (!siteId) { toast.error('Select a site before generating'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, keywords, instructions, model,
          site_id: siteId,
          // When we already have a row (edit mode or an autosave has landed)
          // the task rewrites that row rather than creating a second.
          article_id: boundId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start generation')

      // A brand new article now has a server-side row — take over its URL
      // without a navigation so a reload lands on the article being written
      // instead of on /new. Matches the pattern autosave uses.
      if (data.articleId && data.articleId !== boundId) {
        if (!editId) {
          setAutoCreatedId(data.articleId)
          window.history.replaceState({}, '', `/articles/${data.articleId}`)
        }
      }
      setIdeaSeed(null)
      setGeneratingArticleId(data.articleId)
      toast.success('Generating in the cloud — it will save as a draft when done. Safe to close this tab.', { duration: 6000 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start generation')
      setGenerating(false)
    }
    // setGenerating(false) is called by the poll effect when the row
    // transitions out of 'generating'; leaving it here would clear the
    // in-flight state before the article is actually written.
  }

  /**
   * Send just the featured image to an article that is already live.
   *
   * Republishing would carry the whole post with it, overwriting anything
   * edited on WordPress since — too much to risk for an image that was
   * forgotten. This touches the image and nothing else.
   */
  async function handlePushImage() {
    if (!editId) return
    setPushingImage(true)
    try {
      const res = await fetch(`/api/articles/${editId}/featured-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: featuredImageUrl, alt: featuredImageAlt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send the image')
      toast.success('Featured image is on WordPress')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the image')
    } finally {
      setPushingImage(false)
    }
  }

  async function handleGenerateSEO() {
    if (!title.trim()) { toast.error('Enter a title before generating SEO'); return }
    setGeneratingSEO(true)
    try {
      const res = await fetch('/api/generate-seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, keywords, model: seoModel }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'SEO generation failed')
      collectUsage(data.usage_ids)
      pushReceipt(data.receipt)
      if (data.seo) {
        setFocusKeyphrase(data.seo.focusKeyphrase || '')
        setKeyphraseSynonyms(data.seo.keyphraseSynonyms || '')
        setYoastTitle(data.seo.yoastTitle || '')
        setYoastMetaDescription(data.seo.yoastMetaDescription || '')
        setSlug(data.seo.slug || '')
      }
      toast.success('SEO fields regenerated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'SEO generation failed')
    } finally {
      setGeneratingSEO(false)
    }
  }

  /**
   * The featured image's fields — or nothing at all.
   *
   * An article with no image does not name them on the way to the server. A
   * draft with nothing to illustrate should not be able to fail on the image
   * columns, and PATCH leaves alone whatever it is not sent.
   */
  function imageFields() {
    if (!featuredImageUrl) return {}
    return {
      featured_image_url: featuredImageUrl,
      featured_image_prompt: featuredImagePrompt || null,
      featured_image_alt: featuredImageAlt || null,
    }
  }

  /**
   * Writes the work to the database on its own, so a generated article is not
   * riding on the browser staying open. Everything here has already been paid
   * for in OpenRouter credits; losing it to a closed lid costs real money.
   *
   * Deliberately narrower than an explicit save: it never sends `status`,
   * `scheduled_at` or `scheduled_tz`, so it cannot demote a published article
   * to a draft or quietly pull a scheduled one off the calendar. It saves what
   * was written, and leaves what happens to it to the buttons.
   */
  async function runAutosave(snapshot: string) {
    if (autosaveInFlight.current) return
    autosaveInFlight.current = true
    setAutosaving(true)
    try {
      const fields = {
        title,
        content,
        keywords,
        ai_model: model,
        focus_keyphrase: focusKeyphrase || null,
        keyphrase_synonyms: keyphraseSynonyms || null,
        yoast_title: yoastTitle || null,
        yoast_meta_description: yoastMetaDescription || null,
        slug: slug || null,
        ...imageFields(),
        wp_category_id: wpCategoryId || null,
        // Claimed on every autosave, so the cost of a generation is attached to
        // the article as soon as the article exists rather than at the end.
        usage_ids: usageIds,
      }

      const res = await fetch(
        boundId ? `/api/articles/${boundId}` : '/api/articles',
        {
          method: boundId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            boundId
              // silent: autosaves are not entries in the activity trail.
              ? { ...fields, site_id: siteId, silent: true }
              : { ...fields, site_id: siteId, status: 'draft' }
          ),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Autosave failed')

      if (!boundId && data.article?.id) setAutoCreatedId(data.article.id)
      // The snapshot taken before the request, not the form as it stands now —
      // anything typed while it was in flight is still unsaved, and marking it
      // clean here would drop exactly those keystrokes.
      setCleanSnapshot(snapshot)
      setAutosavedAt(new Date())
      setAutosaveError(null)
    } catch (err) {
      // Left on screen rather than toasted: a toast for something that retries
      // every few seconds is noise, and one that has gone by the time you look
      // up tells you nothing about whether your work is safe.
      setAutosaveError(err instanceof Error ? err.message : 'Autosave failed')
    } finally {
      autosaveInFlight.current = false
      setAutosaving(false)
    }
  }

  useEffect(() => {
    // Nothing to save yet, or the form is not settled enough to trust.
    if (loadingArticle || loadingCats || !catsSettled) return
    // An explicit save or a generation is authoritative — do not race it.
    if (saving || generating || generatingSEO) return
    // The server rejects either of these, so there is nothing to send.
    if (!title.trim() || !siteId) return
    if (cleanSnapshot === null || formSnapshot === cleanSnapshot) return

    // A brand new article only earns a row once it holds something worth
    // keeping — otherwise a stray keystroke in the title leaves a litter of
    // empty drafts behind. Once the row exists, everything after it is saved.
    if (!isPersisted) {
      const hasBody = content.replace(/<[^>]*>/g, '').trim().length > 0
      if (!hasBody && usageIds.length === 0) return
    }

    const timer = setTimeout(() => { void runAutosave(formSnapshot) }, 2000)
    return () => clearTimeout(timer)
    // `autosaving` is a dependency so that finishing one save re-evaluates
    // this: anything typed while that save was in flight is still unsaved, and
    // without it nothing would carry those keystrokes to disk until the user
    // happened to type again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formSnapshot, cleanSnapshot, saving, generating, generatingSEO, autosaving,
      loadingArticle, loadingCats, catsSettled, title, siteId, isPersisted])

  // The header buttons pick a mode and save in the same click, so they pass the
  // mode explicitly — reading `publishMode` there would still see the old value.
  // The calendar does the same with the slot it just picked.
  async function handleSave(
    modeOverride?: PublishMode,
    scheduleOverride?: { iso: string; tz: string }
  ): Promise<boolean> {
    const mode = modeOverride ?? publishMode
    const when = scheduleOverride?.iso ?? scheduledAt
    const zone = scheduleOverride?.tz ?? scheduledTz
    if (!title.trim()) { toast.error('Title is required'); return false }
    if (!siteId) { toast.error('Select a site'); return false }
    if (mode === 'scheduled' && !when) { toast.error('Pick a date and time to schedule'); return false }

    setSaving(true)
    try {
      const payload = {
        site_id: siteId,
        title,
        content,
        keywords,
        ai_model: model,
        // Saving an already-published article must not demote it back to a
        // draft — plain saves keep whatever status the row already has.
        status: mode === 'draft'
          ? (isEdit && saved?.status === 'published' ? 'published' : 'draft')
          : 'scheduled',
        scheduled_at: mode === 'scheduled' ? when : null,
        scheduled_tz: mode === 'scheduled' ? zone : null,
        focus_keyphrase: focusKeyphrase || null,
        keyphrase_synonyms: keyphraseSynonyms || null,
        yoast_title: yoastTitle || null,
        yoast_meta_description: yoastMetaDescription || null,
        slug: slug || null,
        ...imageFields(),
        wp_category_id: wpCategoryId || null,
        usage_ids: usageIds,
      }

      // Updates the row this form is bound to — the one it was opened on, or
      // the one autosave already created. Without this, an explicit save after
      // an autosave would insert a second copy of the same article.
      const res = await fetch(isPersisted ? `/api/articles/${boundId}` : '/api/articles', {
        method: isPersisted ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      const savedId: string = data.article.id

      if (mode === 'now') {
        // Publish immediately to WordPress
        const pubRes = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: savedId }),
        })
        const pubData = await pubRes.json()
        if (!pubRes.ok) throw new Error(pubData.error || 'Publish failed')
        toast.success(isNodeSite ? 'Article published to Node.js site!' : 'Article published to WordPress!')
        if (pubData.imageWarning) {
          toast.error(`Featured image: ${pubData.imageWarning}`, { duration: 8000 })
        }
        if (pubData.categoryWarning) {
          toast.error(`Category: ${pubData.categoryWarning}`, { duration: 10000 })
        }
      } else if (mode === 'scheduled') {
        // An article that already sits on WordPress as a future post stays
        // WordPress's to publish — pulling it back would leave the old post
        // behind. It is rewritten instead, so WP never holds stale content.
        if (data.article?.wp_post_id) {
          const pubRes = await fetch('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articleId: savedId, scheduledAt: when, scheduledTz: zone }),
          })
          const pubData = await pubRes.json()
          if (!pubRes.ok) throw new Error(pubData.error || 'Scheduling failed')
          setCommittedSlot(when)
          toast.success('Article rescheduled on WordPress!')
          if (pubData.categoryWarning) {
            toast.error(`Category: ${pubData.categoryWarning}`, { duration: 10000 })
          }
        } else {
          // Queued here. Nothing goes to WordPress until the slot fires, so the
          // text, the image and the category all stay editable until then —
          // which is the whole point of holding the queue in this app.
          setCommittedSlot(when)
          toast.success('Queued — it publishes at the scheduled time, and stays editable until then')
        }
      } else {
        toast.success(isEdit ? 'Article saved' : 'Article saved as draft')
      }

      setSavedOnce(true)
      setAutosaveError(null)
      if (mode !== 'scheduled') setCommittedSlot(null)
      if (!isEdit) {
        // A new article now has an id — move onto its own page rather than
        // leaving the form ready to insert a second copy.
        router.push(mode === 'draft' ? `/articles/${savedId}` : '/articles')
        return true
      }
      // Editing stays put, so the next tweak does not mean navigating back.
      setSaved(data.article)
      setCleanSnapshot(null)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
      return false
    } finally {
      setSaving(false)
    }
  }

  const contentWords = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

  // The three things an article needs before it is worth publishing. Shown as
  // ticks at the top of the page so "did I do the SEO?" is answered at a
  // glance instead of by scrolling down to check.
  const steps = [
    {
      key: 'article',
      label: 'Article',
      // An applied idea fills the title and drops its description in the
      // editor, which looks exactly like a finished article to a word count.
      // It stays grey until the body is something other than that brief.
      done: !!title.trim() && contentWords > 0 && content !== ideaSeed,
    },
    {
      key: 'seo',
      label: 'SEO',
      done: !!focusKeyphrase.trim() && !!yoastTitle.trim() &&
            !!yoastMetaDescription.trim() && !!slug.trim(),
    },
    {
      key: 'image',
      label: 'Image',
      done: !!featuredImageUrl.trim(),
    },
  ]

  // Is the slot on screen the one actually written to the database?
  const slotCommitted = !!scheduledAt && committedSlot === scheduledAt

  /**
   * Clearing a slot that only exists in the form is a local reset. Clearing one
   * that is live on WordPress has to actually pull it off the calendar there —
   * otherwise the form says "draft" and the article publishes anyway.
   */
  async function handleClearSchedule() {
    if (!slotCommitted || !isEdit || !editId) {
      setScheduledAt('')
      setPublishMode('draft')
      setCommittedSlot(null)
      return
    }

    setSaving(true)
    try {
      // Demotes the WordPress post to a draft, so nothing goes out.
      const res = await fetch(`/api/articles/${editId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_paused: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not unschedule')
      if (data.wpWarning) toast.error(`WordPress: ${data.wpWarning}`, { duration: 8000 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unschedule')
      setSaving(false)
      return
    }
    setSaving(false)

    setScheduledAt('')
    setPublishMode('draft')
    setCommittedSlot(null)
    // Record the article as a draft too, so the row matches what is on screen.
    await handleSave('draft')
  }

  const scheduler = showScheduler ? (
    <ScheduleCalendarModal
      open
      onClose={() => setShowScheduler(false)}
      articleTitle={title || 'This article'}
      siteId={siteId}
      siteName={selectedSite?.name || null}
      currentIso={scheduledAt || null}
      currentTz={scheduledTz}
      saving={saving}
      saveLabel="Schedule"
      onSave={async (iso, tzId) => {
        // Picking the time IS the commit. Parking it in local state and asking
        // for a second click on Schedule below is how an article gets closed
        // with a time chosen and nothing written — which is exactly how one
        // was lost. The article saves and goes to WordPress in this click.
        setScheduledAt(iso)
        setScheduledTz(tzId)
        setPublishMode('scheduled')
        // The slot is passed explicitly: the state set above is a render behind.
        const ok = await handleSave('scheduled', { iso, tz: tzId })
        // Only close on success, so a failure leaves the picker open with the
        // chosen time still in it rather than dropping the user back to a form
        // that looks scheduled and is not.
        if (ok) setShowScheduler(false)
      }}
    />
  ) : null

  if (loadingArticle) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (notFound) {
    return <div className="text-center py-20 text-gray-500">Article not found</div>
  }

  return (
    <div>
      {/* One pinned row: where the article is going, whether it is finished,
          and what happens to it — none of it a scroll away at the moment of
          saving, and none of it taller than it needs to be. `top-14` clears
          the fixed mobile header. */}
      {/* Sticky on desktop only. On mobile the flex-wrap contents (chips +
          pickers + save/schedule/publish + status) can wrap to 4-5 rows —
          sticking that at top-14 covers most of the phone viewport and hides
          the first form field behind it. Let it scroll away with the page. */}
      <div className="md:sticky md:top-0 z-20 -mx-4 md:-mx-8 -mt-6 md:-mt-8 px-4 md:px-8 pt-3 pb-2.5 mb-3 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        {/* Three sections in one wrapping flex row: metadata pills (left/
            centre), publish actions (centre/right), utility icons (far right).
            One responsive layout instead of a mobile/desktop bifurcation —
            everything wraps to additional rows when the width runs out. */}
        <div className="flex flex-wrap items-center gap-2">
          {steps.map((step) => (
            <div
              key={step.key}
              title={step.done ? `${step.label} done` : `${step.label} not done yet`}
              className={`${PILL_BASE} ${step.done ? PILL_GREEN : PILL_NEUTRAL}`}
            >
              <CheckCircle2
                className={`w-3.5 h-3.5 ${step.done ? 'text-green-600 dark:text-green-500' : 'text-gray-300 dark:text-gray-600'}`}
              />
              {step.label}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setShowSitePicker(true)}
            className={`${PILL_BASE} ${PILL_PURPLE}`}
          >
            <Globe className="w-3.5 h-3.5" />
            Site: {selectedSite?.name || (sites.length === 0 ? 'None' : 'Choose')}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {!isNodeSite && (
            <button
              type="button"
              onClick={() => setShowCategoryPicker(true)}
              disabled={!siteId || loadingCats}
              className={`${PILL_BASE} ${PILL_PURPLE}`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Categories: {!siteId ? 'Pick site' : loadingCats ? 'Loading…' : selectedCategory?.name || 'Uncategorized'}
              {loadingCats
                ? <Loader2 className="w-3 h-3 animate-spin opacity-60" />
                : <ChevronDown className="w-3 h-3 opacity-60" />}
            </button>
          )}

          {publishMode === 'scheduled' && scheduledAt && (
            <button
              type="button"
              onClick={() => setShowScheduler(true)}
              title={slotCommitted ? 'Saved and queued.' : 'Not saved yet — pick the time again to commit it.'}
              className={`${PILL_BASE} ${slotCommitted ? PILL_GREEN : PILL_AMBER}`}
            >
              {slotCommitted ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              Scheduled: {formatInZone(scheduledAt, scheduledTz)}
            </button>
          )}

          {/* Pushes the action + icon groups over so the row reads as three
              distinct sections when there is room, but collapses back
              gracefully when the pills already fill the width. */}
          <div className="grow" />

          <button
            onClick={() => { setPublishMode('draft'); handleSave('draft') }}
            disabled={saving || generating}
            className={`${PILL_BASE} ${PILL_ACTION}`}
          >
            <Save className="w-3.5 h-3.5" />
            {saved?.status === 'published' ? 'Save changes' : 'Save draft'}
          </button>

          {!isNodeSite && (
            <button
              type="button"
              onClick={() => setShowScheduler(true)}
              className={`${PILL_BASE} ${publishMode === 'scheduled' ? PILL_ACTION_ACTIVE : PILL_ACTION}`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Schedule for later
            </button>
          )}

          <button
            onClick={() => { setPublishMode('now'); handleSave('now') }}
            disabled={saving || generating}
            className={`${PILL_BASE} ${PILL_PRIMARY}`}
          >
            <Send className="w-3.5 h-3.5" />
            {saved?.status === 'published' ? 'Republish' : 'Publish now'}
          </button>

          <button
            type="button"
            onClick={() => setShowInstructions(true)}
            aria-label="Instruction sets"
            title="Instruction sets"
            className={ICON_BUTTON}
          >
            <ClipboardList className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowKnowledgeBase(true)}
            aria-label="Knowledge base"
            title={`Knowledge base${selectedSite?.name ? ` — ${selectedSite.name}` : ''}`}
            className={ICON_BUTTON}
          >
            <BookMarked className="w-4 h-4" />
          </button>
          <a
            href="/articles/new"
            target="_blank"
            rel="noopener noreferrer"
            title="New article (opens in a new tab)"
            aria-label="New article (opens in a new tab)"
            className="flex items-center justify-center w-11 h-11 shrink-0 rounded-full bg-brand-600 text-white hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </a>
        </div>

        {/* Secondary status line — small, unobtrusive. Autosave state, live
            URL, word count, article-status badge, unschedule. Never in the
            way of the primary row above. */}
        {(saved || autosaveError || autosaving || hasUnsavedWork || autosavedAt) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            {saved && <Badge variant={statusToBadgeVariant(saved.status)}>{saved.status}</Badge>}
            {saved?.word_count ? (
              <span>{saved.word_count.toLocaleString()} words</span>
            ) : null}
            {(saved?.node_post_url || saved?.wp_post_url) && (
              <a
                href={saved.node_post_url || saved.wp_post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline inline-flex items-center gap-1"
              >
                {saved.node_post_url ? 'View live' : 'View on WordPress'}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {autosaveError ? (
              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                <AlertCircle className="w-3 h-3" />
                <span className="truncate max-w-[16rem]" title={autosaveError}>Not saved — {autosaveError}</span>
              </span>
            ) : autosaving ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />Saving…
              </span>
            ) : hasUnsavedWork ? (
              <span>Unsaved changes</span>
            ) : autosavedAt ? (
              <span className="inline-flex items-center gap-1">
                <Check className="w-3 h-3 text-green-600 dark:text-green-500" />
                Saved {autosavedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            ) : null}
            {publishMode === 'scheduled' && scheduledAt && (
              <button
                type="button"
                onClick={handleClearSchedule}
                disabled={saving || generating}
                className="text-gray-400 hover:text-red-500 disabled:opacity-50"
              >
                {slotCommitted ? 'Unschedule' : 'Clear'}
              </button>
            )}
          </div>
        )}
      </div>

      {isEdit && editId && <CollabPanel articleId={editId} />}

      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        {/* Main editor */}
        <div className="flex-1 min-w-0 space-y-4">
          <IdeaGenerator
            siteId={siteId}
            siteName={selectedSite?.name || null}
            onAccept={applyIdea}
            onChangeSite={() => setShowSitePicker(true)}
            defaultModel={preferredModels.idea}
            siteConfirmed={siteConfirmedFor === siteId}
            onSiteConfirmed={() => setSiteConfirmedFor(siteId)}
          />

          {/* Matching the SEO / Yoast card treatment so this reads as the
              distinct "write the article" step rather than a lone tile. */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-brand-500" />
              Generate Article
            </h3>
            <ModelSelect
              value={model}
              onChange={setModel}
              action={
                <button
                  onClick={() => {
                    if (!siteId) { toast.error('Select a site before generating'); return }
                    // Already confirmed this site earlier in the session —
                    // asking again would just be a step the user learns to
                    // dismiss reflexively.
                    if (siteConfirmedFor === siteId) { handleGenerate(); return }
                    setConfirmGenerate(true)
                  }}
                  disabled={generating || !title.trim()}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium px-2 py-1.5 hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {generating
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />Generating…</>
                    : <><Sparkles className="w-3.5 h-3.5 flex-shrink-0" />Generate with AI</>}
                </button>
              }
            />
          </div>

          <div>
            <label
              htmlFor="article-title"
              className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"
            >
              Article Title
            </label>
            <input
              id="article-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Article title..."
              className="w-full px-4 py-3 text-lg font-semibold text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          {/* Collapsed, the body is a fixed pane that scrolls on its own, so
              the SEO fields below stay one flick away instead of a whole
              article away. It stays editable either way — clamping the height
              rather than hiding the overflow keeps the caret visible. */}
          <div>
            <ArticleEditor
              value={content}
              onChange={setContent}
              placeholder="Start writing, or click Generate with AI above..."
              bodyHeightClass={
                contentExpanded || !contentWords
                  ? 'min-h-[400px]'
                  : 'h-[340px] overflow-y-auto'
              }
            />

            {contentWords > 0 && (
              <button
                type="button"
                onClick={() => setContentExpanded((v) => !v)}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {contentExpanded ? (
                  <><ChevronUp className="w-4 h-4" />Collapse article</>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    Expand article
                    <span className="text-gray-400 dark:text-gray-500 font-normal">
                      {contentWords.toLocaleString()} words
                    </span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* SEO Fields — shown after generation or always editable */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              SEO / Yoast Fields
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <ModelSelect
                  value={seoModel}
                  onChange={setSeoModel}
                  lastModelKey={SEO_LAST_MODEL_KEY}
                  variant="compact"
                />
              </div>
              <button
                onClick={handleGenerateSEO}
                disabled={generatingSEO || !title.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50 shrink-0"
              >
                {generatingSEO
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Generating…</>
                  : <><Sparkles className="w-3.5 h-3.5" />Generate SEO</>}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Focus Keyphrase</label>
                <input
                  type="text"
                  value={focusKeyphrase}
                  onChange={(e) => setFocusKeyphrase(e.target.value)}
                  placeholder="main keyword"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Keyphrase Synonym</label>
                <input
                  type="text"
                  value={keyphraseSynonyms}
                  onChange={(e) => setKeyphraseSynonyms(e.target.value)}
                  placeholder="synonym word"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                <span>SEO Title</span>
                <span className={`font-mono ${yoastTitle.length > 70 ? 'text-red-500' : yoastTitle.length >= 50 ? 'text-green-600' : 'text-gray-400'}`}>
                  {yoastTitle.length} chars
                </span>
              </label>
              <input
                type="text"
                value={yoastTitle}
                onChange={(e) => setYoastTitle(e.target.value)}
                placeholder="SEO title"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                <span>Meta Description</span>
                <span className={`font-mono ${yoastMetaDescription.length > 160 ? 'text-red-500' : yoastMetaDescription.length >= 155 ? 'text-green-600' : 'text-gray-400'}`}>
                  {yoastMetaDescription.length}/160
                </span>
              </label>
              <textarea
                value={yoastMetaDescription}
                onChange={(e) => setYoastMetaDescription(e.target.value)}
                placeholder="Meta description (155–160 chars)"
                rows={2}
                maxLength={165}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                <span>URL Slug</span>
                <span className={`font-mono ${slug.length > 60 ? 'text-red-500' : 'text-gray-400'}`}>
                  {slug.length}/60
                </span>
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))}
                placeholder="article-url-slug"
                maxLength={60}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* Sidebar — Instructions and Knowledge Base moved to header icons;
            the sidebar now leads with the Featured Image so the page's
            vertical real estate is spent on the things being edited. */}
        <div className="w-full lg:w-80 lg:shrink-0 space-y-4">
          {/* Featured Image */}
          {/* No articleId on purpose: generating writes the image straight to
              the row, and on an existing article that would commit a change
              the user has not saved yet. The cost row is claimed on save. */}
          <ImageGenerator
            articleTitle={title}
            siteId={siteId}
            initialImageUrl={featuredImageUrl}
            initialPrompt={featuredImagePrompt}
            initialAlt={featuredImageAlt}
            defaultPrompt={title ? `Professional blog featured image for: ${title}` : ''}
            defaultModel={preferredModels.image}
            onImageGenerated={(url, prompt, altText, ids, records) => {
              setFeaturedImageUrl(url)
              setFeaturedImagePrompt(prompt)
              setFeaturedImageAlt(altText)
              collectUsage(ids)
              pushReceipt(records)
            }}
          />

          {/* An article that went out without an image can be given one here
              without republishing the whole post over whatever WordPress now
              holds. Only shown when there is a live post to put it on. */}
          {saved?.status === 'published' && saved.wp_post_id && featuredImageUrl && (
            <button
              type="button"
              onClick={handlePushImage}
              disabled={pushingImage}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {pushingImage
                ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</>
                : <><ImageUp className="w-4 h-4" />Send image to WordPress</>}
            </button>
          )}

          <CostReceipt records={receipt} />
        </div>
      </div>

      {/* Bottom action bar — mirrors the header's Save/Schedule/Publish so a
          user who has scrolled to the foot of a long article does not have
          to page back to the top just to publish. Same handlers; on mobile
          the three buttons stack full-width so the primary action is a
          thumb-reach away. */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row sm:flex-wrap sm:justify-end gap-2">
        <button
          onClick={() => { setPublishMode('draft'); handleSave('draft') }}
          disabled={saving || generating}
          className={`w-full sm:w-auto justify-center ${PILL_BASE} ${PILL_ACTION}`}
        >
          <Save className="w-3.5 h-3.5" />
          {saved?.status === 'published' ? 'Save changes' : 'Save draft'}
        </button>

        {!isNodeSite && (
          <button
            type="button"
            onClick={() => setShowScheduler(true)}
            className={`w-full sm:w-auto justify-center ${PILL_BASE} ${publishMode === 'scheduled' ? PILL_ACTION_ACTIVE : PILL_ACTION}`}
          >
            <Calendar className="w-3.5 h-3.5" />
            Schedule for later
          </button>
        )}

        <button
          onClick={() => { setPublishMode('now'); handleSave('now') }}
          disabled={saving || generating}
          className={`w-full sm:w-auto justify-center ${PILL_BASE} ${PILL_PRIMARY}`}
        >
          <Send className="w-3.5 h-3.5" />
          {saved?.status === 'published' ? 'Republish' : 'Publish now'}
        </button>
      </div>

      {scheduler}

      <Modal
        open={showInstructions}
        onClose={() => setShowInstructions(false)}
        title="Instruction sets"
        maxWidth="max-w-xl"
      >
        <InstructionSets
          selectedId={instructionSetId}
          onSelect={(set) => { handleSelectInstructionSet(set); setShowInstructions(false) }}
          autoSelectDefault={!isEdit}
        />
      </Modal>

      <Modal
        open={showKnowledgeBase}
        onClose={() => setShowKnowledgeBase(false)}
        title={`Knowledge base${selectedSite?.name ? ` — ${selectedSite.name}` : ''}`}
        maxWidth="max-w-xl"
      >
        <SiteKnowledgeBase
          siteId={siteId}
          siteName={selectedSite?.name || 'this site'}
          knowledgeBase={selectedSite?.knowledge_base || ''}
          onSaved={(knowledge_base) =>
            setSites((prev) =>
              prev.map((s) => (s.id === siteId ? { ...s, knowledge_base } : s))
            )
          }
        />
      </Modal>

      <ConfirmSiteModal
        open={confirmGenerate}
        question="Are you sure you want to write this article for"
        siteName={selectedSite?.name || null}
        onClose={() => setConfirmGenerate(false)}
        onChange={() => { setConfirmGenerate(false); setShowSitePicker(true) }}
        onConfirm={() => { setConfirmGenerate(false); setSiteConfirmedFor(siteId); handleGenerate() }}
      />

      <Modal
        open={showSitePicker}
        onClose={() => setShowSitePicker(false)}
        title="Site"
        maxWidth="max-w-md"
      >
        {sites.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No sites connected.{' '}
            <a href="/sites" className="text-brand-600 hover:underline">Add a site first</a>
          </p>
        ) : (
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {sites.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSiteId(s.id); setShowSitePicker(false) }}
                className={PICKER_ROW}
              >
                <span className="truncate">{s.name}</span>
                {s.id === siteId && (
                  <Check className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={showCategoryPicker}
        onClose={() => { setShowCategoryPicker(false); setCategoryQuery('') }}
        title="Category"
        maxWidth="max-w-md"
      >
        {/* A WordPress site can have a hundred categories, so the list is
            filterable rather than something to scroll through. */}
        {categories.length > 8 && (
          <input
            type="text"
            value={categoryQuery}
            onChange={(e) => setCategoryQuery(e.target.value)}
            placeholder="Search categories…"
            className="w-full mb-3 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        )}
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              setWpCategoryId('')
              setShowCategoryPicker(false)
              setCategoryQuery('')
            }}
            className={PICKER_ROW}
          >
            <span className="truncate">Uncategorized</span>
            {wpCategoryId === '' && (
              <Check className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
            )}
          </button>
          {visibleCategories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setWpCategoryId(c.id)
                setShowCategoryPicker(false)
                setCategoryQuery('')
              }}
              className={PICKER_ROW}
            >
              <span className="truncate">
                {c.name}{' '}
                <span className="text-gray-400 dark:text-gray-500">({c.count})</span>
              </span>
              {c.id === wpCategoryId && (
                <Check className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
              )}
            </button>
          ))}
          {categoryQuery.trim() && visibleCategories.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              No category matches “{categoryQuery.trim()}”.
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
