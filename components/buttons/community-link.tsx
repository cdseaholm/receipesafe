'use client';

import Link from 'next/link';
import { MouseEvent, ReactNode } from 'react';
import { toast } from 'sonner';
import { COMMUNITIES_ENABLED, COMMUNITIES_COMING_LATER_MESSAGE } from '@/lib/features';

export default function CommunityLink({ children, className, onNavigate }: {
  children: ReactNode;
  className?: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (COMMUNITIES_ENABLED) {
    return <Link href="/communities?page=1&size=10" className={className} onClick={onNavigate}>{children}</Link>;
  }
  return (
    <button
      type="button"
      aria-disabled="true"
      title={COMMUNITIES_COMING_LATER_MESSAGE}
      className={`${className || ''} !text-gray-500 !bg-gray-200/40 hover:!text-gray-500 hover:!no-underline cursor-not-allowed`}
      onClick={() => toast.info(COMMUNITIES_COMING_LATER_MESSAGE)}
    >
      {children}
    </button>
  );
}
