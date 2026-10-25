'use client';
// Dev-only card fields (provider 'stub', architecture §7.4): raw inputs that look exactly like the designed rows, backed
// by stubStripe.ts. Never rendered with a real Stripe provider. 4000 0000 0000 0002 declines; 4000 0025 0000 3155 asks
// for a simulated 3-D Secure step; any other Luhn-valid number succeeds.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from '@/components/ui';
import { CardRows, ZipInput, type CardFormProps } from './CardFields';
import { createStubStripe, fmtCvc, fmtExp, fmtNum, stubCardErrors, type StubCardValue } from './stubStripe';

export function StubCardFields({ err, handle, disabled }: CardFormProps) {
  const [f, setF] = useState<StubCardValue>({ num: '', exp: '', cvc: '', zip: '' });
  const fRef = useRef(f); fRef.current = f;
  const refs = { num: useRef<HTMLInputElement>(null), exp: useRef<HTMLInputElement>(null), cvc: useRef<HTMLInputElement>(null), zip: useRef<HTMLInputElement>(null) };
  const [ask, setAsk] = useState<null | ((ok: boolean) => void)>(null);
  const stub = useMemo(() => createStubStripe({ authenticate: () => new Promise<boolean>(res => setAsk(() => (ok: boolean) => { setAsk(null); res(ok); })) }), []);

  useEffect(() => {
    handle.current = {
      validate: () => stubCardErrors(fRef.current, new Date()),
      focus: k => refs[k].current?.focus(),
      createPaymentMethod: async () => { const r = await stub.createPaymentMethod(fRef.current); return r.error ? { error: r.error } : { id: r.paymentMethod!.id }; },
      confirmCardPayment: async (clientSecret, pm) => {
        const r = await stub.confirmCardPayment(clientSecret, { payment_method: pm });
        if (r.error) return { error: r.error };
        return r.paymentIntent?.status === 'succeeded' ? { ok: true } : { error: { type: 'api_error' } };
      },
    };
  });

  const input = (k: 'num' | 'exp' | 'cvc', p: React.InputHTMLAttributes<HTMLInputElement>, fmt: (v: string) => string) =>
    <input ref={refs[k]} className={'input' + (err[k] ? ' err' : '')} inputMode="numeric" aria-invalid={!!err[k] || undefined} disabled={disabled} value={f[k]} onChange={e => setF({ ...f, [k]: fmt(e.target.value) })} {...p} />;
  return <>
    <CardRows err={err}
      num={input('num', { autoComplete: 'cc-number', placeholder: '1234 1234 1234 1234' }, fmtNum)}
      exp={input('exp', { autoComplete: 'cc-exp', placeholder: 'MM / YY' }, fmtExp)}
      cvc={input('cvc', { autoComplete: 'cc-csc', placeholder: '123' }, fmtCvc)}
      zip={<ZipInput value={f.zip} onChange={zip => setF({ ...f, zip })} invalid={!!err.zip} inputRef={refs.zip} disabled={disabled} />} />
    {ask && <div className="col enter" role="group" aria-label="Simulated 3-D Secure" style={{ gap: 10, padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', boxShadow: '0 0 0 1px var(--line)' }}>
      <span className="col" style={{ gap: 2 }}><span className="small" style={{ fontWeight: 500 }}>Simulated 3-D Secure</span><span className="xs sub">Your bank asks you to approve this payment. Development stub: no bank is contacted.</span></span>
      <div className="row" style={{ gap: 8 }}><Btn kind="primary" size="sm" autoFocus onClick={() => ask(true)}>Complete</Btn><Btn kind="ghost" size="sm" onClick={() => ask(false)}>Fail</Btn></div>
    </div>}
  </>;
}
