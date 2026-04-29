import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';

export default function Layout({ children }: LayoutProps<'/[[...slug]]'>) {
  return (
    <DocsLayout tree={source.getPageTree()} {...baseOptions()} nav={{ ...baseOptions().nav }}>
      {children}
    </DocsLayout>
  );
}
