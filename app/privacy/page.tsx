import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · Lift Journal",
  description: "How Lift Journal stores your account and training information.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <Link href="/" className="text-brand underline underline-offset-4">
        ← Back to Lift Journal
      </Link>
      <header>
        <p className="eyebrow">YOUR JOURNAL, YOUR DATA</p>
        <h1>Privacy</h1>
        <p className="lead">Last updated 6 September 2026.</p>
      </header>
      <section className="space-y-3">
        <h2>Your account and training</h2>
        <p>
          Lift Journal is an invitation-only training journal operated by Bjarke
          Tornager. When you sign in with Google, we receive your name, email
          address, profile picture and account identifier to create your account
          and keep you signed in. We do not receive your Google password.
        </p>
        <p>
          We store the profile details, workouts, weights, personal records and
          notes you enter so you can keep a training history and synchronize it
          across your devices. Your journal is available to your signed-in
          account. Other athletes do not have access to it.
        </p>
      </section>
      <section className="space-y-3">
        <h2>Where information is stored</h2>
        <p>
          Account data and synchronized journals are hosted on Railway in the
          Netherlands. Session records can include your IP address and browser
          information. We use this information to operate sign-in and protect
          the service. Google handles its own sign-in process under its privacy
          policy.
        </p>
        <p>
          Your browser also keeps a local copy for offline training. Signing out
          hides this copy in the app but does not erase it from the device.
          Export anything you want to keep before clearing the website&apos;s
          browser data. Guest training stays on the device until you explicitly
          bring it into a signed-in account.
        </p>
      </section>
      <section className="space-y-3">
        <h2>Cookies and other services</h2>
        <p>
          We use cookies needed for sign-in and browser storage needed to save
          your journal. We do not use advertising or analytics trackers.
          Technique video links open YouTube, which applies its own privacy
          policy.
        </p>
      </section>
      <section className="space-y-3">
        <h2>Export, correction and deletion</h2>
        <p>
          You can edit your profile and workouts, and export a journal backup
          from Settings. To request an account export, correction or deletion,
          contact{" "}
          <a
            href="mailto:bjarketornager@gmail.com"
            className="text-brand underline underline-offset-4"
          >
            bjarketornager@gmail.com
          </a>
          . We will verify the account before acting on a request.
        </p>
        <p>
          Account data is retained while your account is active. Deleted data
          may remain in recovery backups until those backups expire. Deleting a
          cloud account cannot erase copies on disconnected devices; clear the
          website&apos;s browser data on those devices separately.
        </p>
      </section>
    </main>
  );
}
