import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/clerk-react";
import { ArrowRight, Database, PackageCheck, ShieldCheck } from "lucide-react";
import RealApp from "./RealApp.jsx";

export default function App({ authEnabled = true }) {
  if (!authEnabled) return <RealApp auth={{ isSignedIn: false }} />;

  return (
    <>
      <SignedIn>
        <AuthenticatedWorkspace />
      </SignedIn>

      <SignedOut>
        <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f4f5f2] px-4 py-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(13,148,136,0.2),transparent_35%),radial-gradient(circle_at_85%_80%,rgba(245,158,11,0.16),transparent_32%)]" />
          <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-white bg-white shadow-[0_30px_100px_rgba(15,23,42,0.14)] lg:grid-cols-[1.1fr_.9fr]">
            <div className="bg-slate-950 p-8 text-white sm:p-12">
              <div className="inline-flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-600 text-sm font-black tracking-[0.12em]">ACB</span><span className="text-sm font-bold text-slate-300">Kalkulator pošiljk</span></div>
              <h1 className="mt-12 max-w-xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">Stroški pošiljke, brez ugibanja.</h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-400">Razdeli artikle, poštnino in plačila med prejemnike ter pripravi jasen PDF obračun.</p>
              <div className="mt-10 grid gap-3 text-sm text-slate-300 sm:grid-cols-3 lg:grid-cols-1">
                <LoginBenefit icon={PackageCheck}>Samodejni izračuni po teži</LoginBenefit>
                <LoginBenefit icon={Database}>Zanesljiva lokalna zgodovina</LoginBenefit>
                <LoginBenefit icon={ShieldCheck}>Podatki ostanejo zasebni</LoginBenefit>
              </div>
            </div>
            <div className="flex flex-col justify-center p-8 sm:p-12">
              <p className="eyebrow">Dobrodošel nazaj</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Prijava v ACB</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">Prijavi se z Googlom ali e-pošto. Za vsak račun se uporablja ločena lokalna shramba.</p>
              <SignInButton mode="modal">
                <button className="button-primary mt-8 w-full justify-center py-3 text-base">Prijavi se <ArrowRight className="h-4 w-4" /></button>
              </SignInButton>
              <p className="mt-4 text-center text-xs text-slate-400">Prijava je namenjena identifikaciji uporabnika; paketi se ne zapisujejo več v omejene Clerk metapodatke.</p>
            </div>
          </section>
        </main>
      </SignedOut>
    </>
  );
}

function AuthenticatedWorkspace() {
  const { user, isLoaded, isSignedIn } = useUser();
  if (!isLoaded || !isSignedIn) return null;

  return (
    <RealApp
      auth={{
        isSignedIn: true,
        userId: user.id,
        legacyPackages: user.unsafeMetadata?.packages,
        invoiceSettings: user.unsafeMetadata?.invoice,
        userControl: <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />,
      }}
    />
  );
}

function LoginBenefit({ icon: Icon, children }) {
  return <div className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-teal-300"><Icon className="h-4 w-4" /></span><span>{children}</span></div>;
}
