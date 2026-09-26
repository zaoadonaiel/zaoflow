import AutopilotClient from './AutopilotClient'

export const metadata = {
  title: 'Autopilot',
}

// Auth is enforced upstream in (dashboard)/layout.tsx — this page inherits it
// and stays a thin wrapper. The client does the interactive work.
export default function AutopilotPage() {
  return <AutopilotClient />
}
