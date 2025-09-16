import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import RealApp from "./RealApp.jsx";

export default function App() {
  return (
    <>
      <SignedIn>
        <div className="p-2 flex justify-end"><UserButton /></div>
        <RealApp />
      </SignedIn>

      <SignedOut>
        <div style={{minHeight:"100vh"}} className="grid place-items-center bg-neutral-50">
          <div className="bg-white p-6 rounded-2xl shadow w-80 text-center">
            <h1 className="font-semibold mb-3">Prijava</h1>
            <SignInButton mode="modal">
              <button className="w-full border rounded-2xl px-3 py-2">Prijavi se</button>
            </SignInButton>
            <p className="text-xs text-neutral-500 mt-2">Uporabi Google ali e-pošto.</p>
          </div>
        </div>
      </SignedOut>
    </>
  );
}
