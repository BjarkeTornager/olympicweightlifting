"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="main">
      <h1>Let’s reopen your journal.</h1>
      <p>
        Something went wrong while displaying this screen. Saved training is
        kept separately.
      </p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
