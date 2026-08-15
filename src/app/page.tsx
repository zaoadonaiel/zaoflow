'use client'

import Link from 'next/link'
import {
  Globe,
  Zap,
  Calendar,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Clock,
  RefreshCw,
} from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">Zaoflo</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">How it works</a>
            <a href="#pricing" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Log in
            </Link>
            <Link
              href="/login"
              className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors"
            >
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 text-sm font-medium px-4 py-2 rounded-full mb-8">
            <Sparkles className="w-4 h-4" />
            AI-powered WordPress publishing
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
            Publish SEO content{' '}
            <span className="text-brand-600">on autopilot</span>{' '}
            to WordPress
          </h1>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
            Connect your WordPress sites, let AI write great blog posts, set a publishing schedule.
            Zaoflo handles the rest — automatically, every time.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="flex items-center gap-2 bg-brand-600 text-white font-semibold px-8 py-4 rounded-xl hover:bg-brand-700 transition-colors text-lg w-full sm:w-auto justify-center"
            >
              Start for free <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#how-it-works"
              className="flex items-center gap-2 bg-gray-100 text-gray-700 font-semibold px-8 py-4 rounded-xl hover:bg-gray-200 transition-colors text-lg w-full sm:w-auto justify-center"
            >
              See how it works
            </a>
          </div>
          <p className="text-sm text-gray-400 mt-4">No credit card required</p>
        </div>

        {/* Hero image mockup */}
        <div className="max-w-5xl mx-auto mt-16">
          <div className="bg-gray-950 rounded-2xl overflow-hidden shadow-2xl border border-gray-800">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-800">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-3 text-xs text-gray-500 font-mono">Zaoflo Dashboard</span>
            </div>
            <div className="flex h-72">
              <div className="w-52 bg-gray-900 border-r border-gray-800 p-4 flex flex-col gap-1">
                {['Dashboard', 'Sites', 'Articles', 'Schedules', 'Settings'].map((item, i) => (
                  <div
                    key={item}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                      i === 2
                        ? 'bg-brand-600/20 text-brand-400 font-medium'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${i === 2 ? 'bg-brand-500' : 'bg-gray-700'}`} />
                    {item}
                  </div>
                ))}
              </div>
              <div className="flex-1 p-6 space-y-3">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="h-3 w-24 bg-gray-700 rounded mb-2" />
                    <div className="h-2 w-40 bg-gray-800 rounded" />
                  </div>
                  <div className="h-8 w-28 bg-brand-600/30 rounded-lg border border-brand-500/30" />
                </div>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 p-3 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="h-2 w-48 bg-gray-700 rounded" />
                    <div className="h-5 w-16 bg-green-500/20 rounded-full border border-green-500/30" />
                    <div className="h-2 w-24 bg-gray-800 rounded ml-auto" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Logos / social proof */}
      <section className="py-12 px-6 border-y border-gray-100">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm text-gray-400 uppercase tracking-wide font-medium mb-6">Works with any WordPress site</p>
          <div className="flex items-center justify-center gap-10 flex-wrap">
            {['WordPress.com', 'WooCommerce', 'Elementor', 'Divi', 'Yoast SEO'].map((name) => (
              <span key={name} className="text-gray-400 font-medium text-sm">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Everything you need to scale content
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              Manage multiple WordPress sites, generate AI content with your choice of model,
              and publish on a schedule — all from one dashboard.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Globe,
                title: 'Multi-Site Management',
                desc: 'Connect unlimited WordPress sites — yours or your clients. One dashboard, full control.',
                color: 'bg-blue-50 text-blue-600',
              },
              {
                icon: Sparkles,
                title: 'AI Content Generation',
                desc: 'Use any AI model via OpenRouter — Claude, GPT-4o, Gemini, Llama. You pick the brain.',
                color: 'bg-brand-50 text-brand-600',
              },
              {
                icon: Calendar,
                title: 'Flexible Scheduling',
                desc: 'Publish daily, every 48h, weekly, monthly, twice a month, or set a custom schedule.',
                color: 'bg-green-50 text-green-600',
              },
              {
                icon: Zap,
                title: 'One-Click Publish',
                desc: "Write or generate a post and publish it to WordPress instantly — no FTP, no admin login.",
                color: 'bg-orange-50 text-orange-600',
              },
              {
                icon: BarChart3,
                title: 'Publish Analytics',
                desc: 'See every article\'s status: drafted, scheduled, published, or failed — with error details.',
                color: 'bg-purple-50 text-purple-600',
              },
              {
                icon: RefreshCw,
                title: 'Recurring Autopilot',
                desc: 'Set a topic strategy once. Zaoflo writes and publishes fresh content on autopilot.',
                color: 'bg-rose-50 text-rose-600',
              },
            ].map(({ icon: Icon, title, desc, color }) => (
              <div key={title} className="p-6 bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Up and running in minutes</h2>
            <p className="text-xl text-gray-500">Three steps to automated WordPress content publishing.</p>
          </div>
          <div className="space-y-8">
            {[
              {
                step: '01',
                title: 'Connect your WordPress site',
                desc: 'Install the Zaoflo plugin on your WordPress site and add your site URL with an Application Password. No complicated setup — takes 2 minutes.',
              },
              {
                step: '02',
                title: 'Add your OpenRouter API key & choose a model',
                desc: 'Paste your OpenRouter key in Settings. Pick any AI model — Claude, GPT-4o, Gemini, or an open-source model. You can use different models per article.',
              },
              {
                step: '03',
                title: 'Write, generate, and schedule',
                desc: 'Type your own content or let AI write it. Set a publishing schedule (daily, weekly, or custom). Zaoflo publishes automatically from then on.',
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex gap-8 items-start">
                <div className="flex-shrink-0 w-14 h-14 bg-brand-600 text-white rounded-2xl flex items-center justify-center font-bold text-lg">
                  {step}
                </div>
                <div className="pt-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
                  <p className="text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Start publishing smarter today
          </h2>
          <p className="text-xl text-gray-500 mb-10">
            Join hundreds of bloggers and agencies automating their WordPress content.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="flex items-center gap-2 bg-brand-600 text-white font-semibold px-8 py-4 rounded-xl hover:bg-brand-700 transition-colors text-lg"
            >
              Get started for free <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <div className="flex items-center justify-center gap-6 mt-8">
            {['Free plan available', 'No credit card required', 'Cancel anytime'].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-gray-500">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-gray-900">Zaoflo</span>
          </div>
          <div className="flex items-center gap-8 text-sm text-gray-500">
            <Link href="/privacy" className="hover:text-gray-900 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-900 transition-colors">Terms</Link>
            <Link href="mailto:support@zaoflo.com" className="hover:text-gray-900 transition-colors">Support</Link>
          </div>
          <p className="text-sm text-gray-400">© 2026 Zaoflo. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
