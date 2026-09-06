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
          Lift Journal is an invitation-only training journal. When you sign in
          with Google, we receive your name, email address, profile picture and
          account identifier to create your account and keep you signed in. We
          do not receive your Google password. Your name and email are shown
          only to you in the iPhone account screen, and are not included in
          Coach model requests.
        </p>
        <p>
          The site owner can invite a specific Google email and revoke its
          access. We store invited email addresses and invitation dates for this
          purpose. Only the owner can see and manage that invitation list;
          inviting someone does not share either person’s journal.
        </p>
        <p>
          We store the profile details, strength and cardio activities, weights,
          personal records and notes you enter so you can keep a training
          history and synchronize it across your devices. Your journal is
          available to your signed-in account. Other athletes do not have access
          to it.
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
          Your browser keeps a device copy to protect edits until they sync. The
          app requires an online session check before opening your profile or
          records; a cached identity cannot unlock the journal. Signing out or
          losing authorization clears confirmed account copies from this
          browser. Unsynced edits are retained for recovery after the owner
          signs in again. Revoking a session cannot remotely erase a
          disconnected device or an exported backup. Clear this website’s
          browser data on shared devices after saving anything you need to keep.
        </p>
        <p>
          The native iPhone app keeps its separate sign-in credential in iOS
          Keychain. Confirmed journal entries and images are held in memory, and
          access is checked with the server before opening them. A prepared but
          unacknowledged save is kept in an account-specific file using iOS file
          protection and excluded from device backups, so it can be retried
          without duplication. Private screens are covered while inactive or
          awaiting access verification. User-requested JSON exports are separate
          copies; they are not remotely erased by sign-out or revocation.
        </p>
      </section>
      <section className="space-y-3">
        <h2>Your training assistant</h2>
        <p>
          When enabled, the assistant sends your messages, recent conversation
          and relevant training records to the provider named in Coach.
          OpenRouter routes requests to a model provider; this app requires tool
          support, no data collection and zero data retention routing. These
          filters reflect provider policies and do not guarantee processing in
          the EU. OpenRouter and Ollama Cloud operate outside this Railway
          database and may process data outside the Netherlands. A private
          Ollama installation processes requests on its configured host. Your
          Google account name, email, password and database credentials are not
          included in model requests.
        </p>
        <p>
          Conversation is stored with your account. The app removes conversation
          older than 90 days when you next use the assistant. Proposals
          temporarily include journal snapshots for safe save and undo; they
          expire after 24 hours and are removed on subsequent assistant use.
          Clear conversation removes its messages and proposals immediately,
          while keeping saved workouts. Journal backup exports do not include
          chat; use your browser to copy any conversation you want to keep.
        </p>
        <p>
          The assistant can read only your journal through limited tools. It
          prepares changes for review; you confirm a proposal before it is
          saved. Provider failures do not remove your existing training. See{" "}
          <a href="https://openrouter.ai/privacy" className="underline">
            OpenRouter’s privacy policy
          </a>{" "}
          and{" "}
          <a href="https://ollama.com/privacy" className="underline">
            Ollama’s privacy policy
          </a>{" "}
          for their own data handling.
        </p>
      </section>
      <section className="space-y-3">
        <h2>Food journal and private images</h2>
        <p>
          Meals, portions, nutrition estimates and diet targets are saved to
          your account alongside your training, and included in journal backups.
          The browser keeps a device copy behind the sign-in gate. The assistant
          can read your own logged nutrition when answering food questions.
        </p>
        <p>
          Uploaded food, sleep, activity and other images are stored privately
          in the account database on Railway. We resize and re-encode photos,
          removing embedded location and camera metadata. They require sign-in
          and internet to view; photos are not stored in the offline cache.
          Choosing Send in Coach shares the attached images with the configured
          assistant provider for analysis. With automatic tagging enabled,
          uploading also sends the image to that provider to identify its
          category and descriptive tags. You can turn automatic tagging off
          before uploading (in the attachment menu on iPhone), or choose Retag
          automatically on the web later. Existing uploads are not sent for
          tagging without that action. Uncertain images stay in Needs review.
          Categories and tags are editable; tagging does not create meal or
          health records.
        </p>
        <p>
          Food lets you edit or delete meals, download individual photos and
          delete photos after removing their meal links. Deleting a meal or
          clearing chat keeps its catalog photos. Photos are retained until you
          delete them or your account; recovery backups may retain deleted data
          until they expire. Journal JSON backups contain meal photo references,
          not image files or category metadata. Download images from the image
          library; operational database backups include images and their tags.
          Calorie and macro estimates can be inaccurate; you can correct them
          before or after saving.
        </p>
      </section>
      <section className="space-y-3">
        <h2>Daily health check-ins</h2>
        <p>
          You can choose to record sleep, energy, muscle soreness, water,
          bodyweight and personal notes. These are sensitive, self-reported
          health details. They are stored in your account journal, kept in your
          browser’s device copy and included in journal backups. You can edit or
          delete them in Health history.
        </p>
        <p>
          When you ask Coach for a daily plan or health guidance, relevant
          check-ins, meals and training records are sent to the configured
          assistant provider. The overview also displays simple suggestions
          based on your entries. The app does not collect wearable or clinical
          data, monitor you in the background, or diagnose conditions.
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
          contact the person who invited you to Lift Journal. We will verify the
          account before acting on a request.
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
