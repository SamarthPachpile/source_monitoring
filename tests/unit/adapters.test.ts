import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { rbiAdapter } from '../../src/regulatory/adapters/rbi.adapter';
import { samaAdapter } from '../../src/regulatory/adapters/sama.adapter';
import { cbuaeAdapter } from '../../src/regulatory/adapters/cbuae.adapter';
import { cbkAdapter } from '../../src/regulatory/adapters/cbk.adapter';

describe('Source Adapters Unit Tests (Mocked Fixtures)', () => {
  it('parses RBI RSS feed and extracts reference numbers, titles, and dates', async () => {
    const mockRssXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>NOTIFICATIONS FROM RBI</title>
    <link>https://www.rbi.org.in</link>
    <item>
      <title>Implementation of Section 51A of UAPA, 1967: Updates to UNSC 1988 List</title>
      <link>https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13749&amp;Mode=0</link>
      <pubDate>Fri, 30 Oct 2026 15:15:00 GMT</pubDate>
      <description><![CDATA[RBI/2026-27/303\nDoR.AML.REC.255/14.06.001/2026-27\nOctober 30, 2026\nChairpersons/CEOs]]></description>
    </item>
  </channel>
</rss>`;

    // Mock parseURL in parser
    const parseSpy = vi.spyOn((rbiAdapter as any).parser, 'parseURL').mockResolvedValueOnce({
      title: 'NOTIFICATIONS FROM RBI',
      items: [
        {
          title: 'Implementation of Section 51A of UAPA, 1967: Updates to UNSC 1988 List',
          link: 'https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13749&Mode=0',
          pubDate: 'Fri, 30 Oct 2026 15:15:00 GMT',
          contentSnippet: 'RBI/2026-27/303\nDoR.AML.REC.255/14.06.001/2026-27'
        }
      ]
    });

    const publications = await rbiAdapter.discover();
    expect(publications.length).toBe(1);
    expect(publications[0].sourceKey).toBe('rbi');
    expect(publications[0].authority).toBe('RBI');
    expect(publications[0].jurisdiction).toBe('IN');
    expect(publications[0].referenceNumber).toBe('RBI/2026-27/303');
    expect(publications[0].title).toContain('Implementation of Section 51A');

    parseSpy.mockRestore();
  });

  it('parses SAMA HTML table and extracts circular numbers, dates, titles, and links', async () => {
    const mockSamaHtml = `
      <table>
        <tbody>
          <tr>
            <td><a href="/en/node/11111">482028988</a></td>
            <td><a href="/en/node/11111">Integration with the Security Council Resolutions Notification System</a></td>
            <td>01/10/2026</td>
            <td>20/04/1448</td>
            <td>In-Force</td>
            <td>Banking Sector</td>
          </tr>
        </tbody>
      </table>
    `;

    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: mockSamaHtml });

    const publications = await samaAdapter.discover();
    expect(publications.length).toBe(1);
    expect(publications[0].sourceKey).toBe('sama');
    expect(publications[0].authority).toBe('SAMA');
    expect(publications[0].jurisdiction).toBe('SA');
    expect(publications[0].referenceNumber).toBe('482028988');
    expect(publications[0].title).toBe('Integration with the Security Council Resolutions Notification System');
    expect(publications[0].documentUrl).toBe(
      'https://rulebook.sama.gov.sa/en/node/11111'
    );

    getSpy.mockRestore();
  });

  it('parses CBUAE Banking regulations and generates structured regulatory entries', async () => {
    const mockCbuaeHtml = `
      <div>
        <a href="/en/rulebook/regulations-re-capital-adequacy">Regulations Re Capital Adequacy</a>
        <a href="/en/rulebook/standards-capital-adequacy-banks-uae">Standards for Capital Adequacy of Banks in the UAE</a>
      </div>
    `;

    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: mockCbuaeHtml });

    const publications = await cbuaeAdapter.discover();
    expect(publications.length).toBe(2);
    expect(publications[0].sourceKey).toBe('cbuae');
    expect(publications[0].authority).toBe('CBUAE');
    expect(publications[0].jurisdiction).toBe('AE');
    expect(publications[0].referenceNumber).toBe('CBUAE-REGULATIONS-RE-CAPITAL-ADEQUACY');
    expect(publications[0].documentType).toBe('Regulation');
    expect(publications[1].documentType).toBe('Standard');

    getSpy.mockRestore();
  });

  it('parses CBK circulars and extracts PDF documents, circular reference, and title', async () => {
    const mockCbkHtml = `
      <table>
        <tr>
          <td>2026</td>
          <td><a href="/uploads/banking_circulars/1614513480_Banking Circular No. 1 of 2026 - Changes to CBK Discount Window Facility.pdf">Banking Circular No. 1 of 2026 - Changes to CBK Discount Window Facility</a></td>
        </tr>
      </table>
    `;

    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: mockCbkHtml });

    const publications = await cbkAdapter.discover();
    expect(publications.length).toBe(1);
    expect(publications[0].sourceKey).toBe('cbk');
    expect(publications[0].authority).toBe('CBK');
    expect(publications[0].jurisdiction).toBe('KE');
    expect(publications[0].referenceNumber).toBe('Banking Circular No. 1 of 2026');
    expect(publications[0].documentUrl).toContain('https://www.centralbank.go.ke/uploads/banking_circulars/');

    getSpy.mockRestore();
  });
});
