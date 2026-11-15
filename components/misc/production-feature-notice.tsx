'use client';

import { toast } from 'sonner';
import { SHOW_PRODUCTION_FEATURE_NOTICES } from '@/lib/features';

export default function ProductionFeatureNotice({ label, features, description }: {
    label: string;
    features: string[];
    description?: string;
}) {
    if (!SHOW_PRODUCTION_FEATURE_NOTICES) return null;
    return (
        <section aria-label={`${label} coming later`} className="rounded-md border border-accent/15 bg-[var(--surfaceWash)] p-3">
            <p className="text-sm font-semibold text-mainText">{label} <span className="font-normal text-mainText/60">· Coming later</span></p>
            {description && <p className="mt-1 text-sm text-mainText/65">{description}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
                {features.map(feature => (
                    <button key={feature} type="button" aria-disabled="true"
                        title={`${feature} is coming later`}
                        className="cursor-not-allowed rounded-md border border-gray-300/50 bg-gray-200/40 px-3 py-2 text-sm text-gray-500"
                        onClick={() => toast.info(`${feature} is coming later`)}>
                        {feature}
                    </button>
                ))}
            </div>
        </section>
    );
}
