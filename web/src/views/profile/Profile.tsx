import { currentUsername, signOut } from "../../auth";

/** The Profile tab: who's signed in and sign out. Theme (04), Meal windows (07) and passkeys (03) land here. */
export function Profile() {
  return (
    <div className="profile">
      <h2>Profile</h2>
      <p>Signed in as <strong>{currentUsername()}</strong></p>
      <button onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}
