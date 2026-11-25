import { gte, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  birthReports,
  dataRevisionLogs,
  ingestionStaging,
  sources,
} from './schema.ts';

let seedPromise: Promise<void> | null = null;

async function runSeed() {
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sources);

  if ((existing[0]?.count ?? 0) > 0) {
    await seed2025And2026IfMissing();
    return;
  }

  const insertedSources = await db
    .insert(sources)
    .values([
      {
        name: 'MOH Gaza',
        type: 'Government',
        urlOrHandle: 'https://www.moh.gov.ps',
        credibilityTier: 'Tier 1 - Primary Registry',
        description:
          'Ministry of Health hospital maternity ward delivery logs and monthly epidemiological bulletins across Gaza governorates.',
        seriesColor: '#1E3A8A',
      },
      {
        name: 'Ministry of Interior',
        type: 'Government',
        urlOrHandle: 'https://www.moi.gov.ps',
        credibilityTier: 'Tier 1 - Primary Registry',
        description:
          'Civil Status Registry compiling registered live births, issued birth certificates, and district population ledgers.',
        seriesColor: '#B45309',
      },
      {
        name: 'UN OCHA',
        type: 'Multilateral Agency',
        urlOrHandle: 'https://www.ochaopt.org',
        credibilityTier: 'Tier 2 - Multilateral',
        description:
          'United Nations Office for the Coordination of Humanitarian Affairs situation reports and humanitarian needs snapshots.',
        seriesColor: '#0F766E',
      },
      {
        name: 'UNFPA Palestine',
        type: 'Multilateral Agency',
        urlOrHandle: 'https://palestine.unfpa.org',
        credibilityTier: 'Tier 2 - Multilateral',
        description:
          'United Nations Population Fund reproductive health situation updates estimating monthly and daily deliveries in Gaza.',
        seriesColor: '#6D28D9',
      },
      {
        name: 'Al Jazeera',
        type: 'News Media',
        urlOrHandle: 'https://www.aljazeera.com',
        credibilityTier: 'Tier 3 - Media / Secondary',
        description:
          'Correspondent reporting and live-blog summaries citing hospital directors, municipal officials, and health briefings.',
        seriesColor: '#B91C1C',
      },
      {
        name: 'MOH Official Telegram',
        type: 'Social Media Channel',
        urlOrHandle: 'https://t.me/MOHMediaGaza',
        credibilityTier: 'Tier 1 - Primary Registry',
        description:
          'Rapid press statements and preliminary monthly tallies distributed via the Ministry of Health public Telegram channel.',
        seriesColor: '#334155',
      },
    ])
    .returning();

  const sourceMap = new Map(insertedSources.map((s) => [s.name, s.id]));
  const sid = (name: string) => {
    const id = sourceMap.get(name);
    if (!id) throw new Error(`Missing seeded source: ${name}`);
    return id;
  };

  const reportSeedRows = [
    // Yearly Totals (2022 - 2024)
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Yearly',
      periodValue: '2022',
      count: 66912,
      publicationDate: new Date('2023-01-18T09:00:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/reports/2022-civil-registry-annual',
      rawTextSnippet:
        'The Civil Status Department registered 66,912 live births across the five governorates of the Gaza Strip during calendar year 2022, an average of 183 newborns per day.',
      documentRef: 'MOI-CSR-2022-ANNUAL',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Yearly',
      periodValue: '2022',
      count: 65840,
      publicationDate: new Date('2023-02-04T11:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/annual-health-report-2022',
      rawTextSnippet:
        'Hospital and licensed maternity clinic deliveries recorded by MOH Gaza totaled 65,840 live births in 2022, excluding delayed home-birth civil registrations.',
      documentRef: 'MOH-AHR-2022-04',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Yearly',
      periodValue: '2022',
      count: 66500,
      publicationDate: new Date('2023-03-10T14:00:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/publications/gaza-maternal-2022',
      rawTextSnippet:
        'UNFPA demographic modeling estimates approximately 66,500 births in Gaza across 2022 based on PCBS fertility projections and clinic attendance.',
      documentRef: 'UNFPA-PSE-2022-REV1',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Yearly',
      periodValue: '2023',
      count: 58420,
      publicationDate: new Date('2024-02-12T10:15:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/reports/2023-civil-registry-summary',
      rawTextSnippet:
        'Despite fourth-quarter civil office disruptions, 58,420 births were formally entered into the Gaza civil registry for 2023, with an acknowledged registration backlog in northern governorates.',
      documentRef: 'MOI-CSR-2023-REV2',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Yearly',
      periodValue: '2023',
      count: 61890,
      publicationDate: new Date('2024-01-29T16:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/annual-2023-maternity',
      rawTextSnippet:
        'Compiled hospital logbooks and emergency field maternity units recorded 61,890 births throughout 2023, incorporating reconciled Q4 shelter delivery sheets.',
      documentRef: 'MOH-MAT-2023-FINAL',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Yearly',
      periodValue: '2023',
      count: 63200,
      publicationDate: new Date('2024-02-20T12:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-annual-review-2023',
      rawTextSnippet:
        'Humanitarian health cluster partners estimate 63,200 deliveries occurred in Gaza during 2023 when accounting for unrecorded out-of-hospital births in Q4.',
      documentRef: 'OCHA-OPT-2023-SYNTH',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Yearly',
      periodValue: '2024',
      count: 53400,
      publicationDate: new Date('2025-01-22T15:30:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/publications/gaza-2024-sitrep',
      rawTextSnippet:
        'UNFPA estimates roughly 53,400 births across the Gaza Strip in 2024, averaging 145 to 150 deliveries daily amid severe maternity ward contraction.',
      documentRef: 'UNFPA-SITREP-2024-YR',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Yearly',
      periodValue: '2024',
      count: 48760,
      publicationDate: new Date('2025-02-05T13:10:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/annual-2024-preliminary',
      rawTextSnippet:
        'Documented births registered through operational hospitals and primary care clinics reached 48,760 in 2024; home and displacement-camp deliveries without hospital intake remain under audit.',
      documentRef: 'MOH-AHR-2024-PRELIM',
      confidenceStatus: 'Disputed',
    },

    // Monthly Series: 2023-09 through 2024-12 across multiple sources
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2023-09',
      count: 5510,
      publicationDate: new Date('2023-10-04T09:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2023-09',
      rawTextSnippet:
        'September 2023 monthly maternity statistics show 5,510 live births delivered across public and NGO maternity wards in Gaza.',
      documentRef: 'MOH-MTH-2023-09',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Monthly',
      periodValue: '2023-09',
      count: 5645,
      publicationDate: new Date('2023-10-05T11:20:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/civil-stats/2023-09',
      rawTextSnippet:
        'Civil registry branches issued 5,645 new birth certificates during September 2023 (188.2 per day).',
      documentRef: 'MOI-MTH-2023-09',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2023-10',
      count: 4980,
      publicationDate: new Date('2023-11-11T17:45:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2023-10-reconciled',
      rawTextSnippet:
        'Reconciled hospital admission ledgers indicate 4,980 births recorded inside functioning Gaza health facilities during October 2023.',
      documentRef: 'MOH-MTH-2023-10-R2',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2023-10',
      count: 5520,
      publicationDate: new Date('2023-11-03T13:00:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/news/gaza-october-2023-births',
      rawTextSnippet:
        'With an estimated 50,000 pregnant women in Gaza, UNFPA estimates 5,520 women gave birth in October 2023, roughly 180 births per day.',
      documentRef: 'UNFPA-FLASH-2023-10',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Al Jazeera'),
      periodType: 'Monthly',
      periodValue: '2023-10',
      count: 5400,
      publicationDate: new Date('2023-11-05T19:15:00Z'),
      sourceUrl: 'https://www.aljazeera.com/news/2023/11/5/gaza-maternity-crisis',
      rawTextSnippet:
        'Medical officials and humanitarian agencies reported roughly 5,400 newborns delivered across Gaza in October despite widespread power outages.',
      documentRef: 'AJE-20231105-MAT',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2023-11',
      count: 4620,
      publicationDate: new Date('2023-12-14T14:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2023-11-reconciled',
      rawTextSnippet:
        'November 2023 facility reports log 4,620 births, heavily concentrated in southern referral hospitals (Al-Emirati and Nasser Medical Complex).',
      documentRef: 'MOH-MTH-2023-11-R1',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2023-11',
      count: 5400,
      publicationDate: new Date('2023-12-06T18:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-sitrep-61',
      rawTextSnippet:
        'Health Cluster estimates approximately 180 women give birth daily in Gaza—totaling 5,400 births in November—many in UNRWA shelters without surgical access.',
      documentRef: 'OCHA-SITREP-061',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Official Telegram'),
      periodType: 'Monthly',
      periodValue: '2023-11',
      count: 4290,
      publicationDate: new Date('2023-12-02T20:10:00Z'),
      sourceUrl: 'https://t.me/MOHMediaGaza/4102',
      rawTextSnippet:
        'Preliminary tally from accessible southern wards records 4,290 births in November pending northern hospital paper log reconciliation.',
      documentRef: 'TG-MOH-4102',
      confidenceStatus: 'Superseded',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2023-12',
      count: 4510,
      publicationDate: new Date('2024-01-12T10:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2023-12',
      rawTextSnippet:
        'December 2023 compiled hospital logs register 4,510 live deliveries across Gaza governorates following partial restoration of Rafah clinics.',
      documentRef: 'MOH-MTH-2023-12',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2023-12',
      count: 5580,
      publicationDate: new Date('2024-01-09T15:00:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/dec-2023',
      rawTextSnippet:
        'UNFPA estimates 5,580 deliveries across December 2023 based on maternal cohort tracking, noting 15% faced emergency obstetric complications.',
      documentRef: 'UNFPA-SR-2023-12',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-01',
      count: 4380,
      publicationDate: new Date('2024-02-14T11:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-01',
      rawTextSnippet:
        'January 2024 hospital deliveries totaled 4,380 births, with Al-Emirati Maternity Hospital handling over half of all recorded cases.',
      documentRef: 'MOH-MTH-2024-01-V2',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2024-01',
      count: 5150,
      publicationDate: new Date('2024-02-07T16:45:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-sitrep-114',
      rawTextSnippet:
        'OCHA and UNICEF partners report an estimated 5,150 newborns born across Gaza in January 2024 amid overcrowding in Rafah.',
      documentRef: 'OCHA-SITREP-114',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Monthly',
      periodValue: '2024-01',
      count: 3940,
      publicationDate: new Date('2024-02-18T09:20:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/civil-stats/2024-01',
      rawTextSnippet:
        'Temporary civil registry desks in Rafah and Deir al-Balah processed 3,940 birth registrations for January 2024.',
      documentRef: 'MOI-MTH-2024-01',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-02',
      count: 4215,
      publicationDate: new Date('2024-03-10T12:15:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-02',
      rawTextSnippet:
        'MOH Gaza monthly update records 4,215 facility deliveries during February 2024 (29 days), averaging 145.3 per day.',
      documentRef: 'MOH-MTH-2024-02',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2024-02',
      count: 4870,
      publicationDate: new Date('2024-03-08T14:20:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/feb-2024',
      rawTextSnippet:
        'UNFPA projects 4,870 total births during February 2024 across hospitals, field clinics, and informal shelter deliveries.',
      documentRef: 'UNFPA-SR-2024-02',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-03',
      count: 4390,
      publicationDate: new Date('2024-04-16T09:40:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-03-revised',
      rawTextSnippet:
        'Revised March 2024 maternity ledger records 4,390 live births after integrating late paper logs from Kamal Adwan and Al-Awda clinics.',
      documentRef: 'MOH-MTH-2024-03-R3',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2024-03',
      count: 4960,
      publicationDate: new Date('2024-04-11T17:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-sitrep-151',
      rawTextSnippet:
        'Humanitarian partners estimate 4,960 births in Gaza during March 2024 (approximately 160 daily), noting rising neonatal ICU admissions.',
      documentRef: 'OCHA-SITREP-151',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Al Jazeera'),
      periodType: 'Monthly',
      periodValue: '2024-03',
      count: 4650,
      publicationDate: new Date('2024-04-06T13:10:00Z'),
      sourceUrl: 'https://www.aljazeera.com/news/2024/4/6/march-births-gaza',
      rawTextSnippet:
        'Hospital directors in Rafah and central Gaza cited roughly 4,650 births throughout March 2024 in televised briefings.',
      documentRef: 'AJE-20240406-BTH',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('MOH Official Telegram'),
      periodType: 'Monthly',
      periodValue: '2024-03',
      count: 4120,
      publicationDate: new Date('2024-04-03T18:20:00Z'),
      sourceUrl: 'https://t.me/MOHMediaGaza/5288',
      rawTextSnippet:
        'Initial Telegram summary counts 4,120 births in March 2024 prior to receiving northern Gaza clinic sheets.',
      documentRef: 'TG-MOH-5288',
      confidenceStatus: 'Superseded',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-04',
      count: 4180,
      publicationDate: new Date('2024-05-12T10:50:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-04',
      rawTextSnippet:
        'April 2024 documented maternity deliveries across Gaza facilities stood at 4,180 live births.',
      documentRef: 'MOH-MTH-2024-04',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2024-04',
      count: 4680,
      publicationDate: new Date('2024-05-09T14:00:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/apr-2024',
      rawTextSnippet:
        'UNFPA estimates 4,680 women delivered in Gaza during April 2024 as maternal nutrition indicators deteriorated.',
      documentRef: 'UNFPA-SR-2024-04',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-05',
      count: 3760,
      publicationDate: new Date('2024-06-15T11:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-05',
      rawTextSnippet:
        'Following the May evacuation of Rafah maternity facilities, recorded hospital deliveries dipped to 3,760 births while field tent births rose.',
      documentRef: 'MOH-MTH-2024-05-R2',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2024-05',
      count: 4520,
      publicationDate: new Date('2024-06-10T16:15:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-sitrep-176',
      rawTextSnippet:
        'OCHA estimates 4,520 births in May 2024 across Deir al-Balah, Khan Younis field hospitals, and displacement sites.',
      documentRef: 'OCHA-SITREP-176',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Monthly',
      periodValue: '2024-05',
      count: 3410,
      publicationDate: new Date('2024-06-21T08:45:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/civil-stats/2024-05',
      rawTextSnippet:
        'Civil registration offices logged 3,410 certificates in May 2024 due to closure of Rafah municipal registration branches.',
      documentRef: 'MOI-MTH-2024-05',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-06',
      count: 3890,
      publicationDate: new Date('2024-07-14T13:20:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-06',
      rawTextSnippet:
        'June 2024 maternity records count 3,890 live births after expansion of Nasser Medical Complex and Al-Aqsa maternity wards.',
      documentRef: 'MOH-MTH-2024-06',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2024-06',
      count: 4410,
      publicationDate: new Date('2024-07-11T15:30:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/jun-2024',
      rawTextSnippet:
        'UNFPA situation report estimates 4,410 births across Gaza in June 2024 (~147 deliveries daily).',
      documentRef: 'UNFPA-SR-2024-06',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-07',
      count: 4045,
      publicationDate: new Date('2024-08-12T10:10:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-07',
      rawTextSnippet:
        'July 2024 facility births totaled 4,045 across 11 operational maternity departments and NGO field hospitals.',
      documentRef: 'MOH-MTH-2024-07',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2024-07',
      count: 4480,
      publicationDate: new Date('2024-08-08T17:20:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-sitrep-201',
      rawTextSnippet:
        'Health Cluster partners report an estimated 4,480 deliveries in July 2024 across central and southern Gaza.',
      documentRef: 'OCHA-SITREP-201',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-08',
      count: 3980,
      publicationDate: new Date('2024-09-13T09:50:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-08',
      rawTextSnippet:
        'August 2024 verified maternity logs enumerate 3,980 births, with mobile midwife teams assisting 310 shelter deliveries.',
      documentRef: 'MOH-MTH-2024-08',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2024-08',
      count: 4390,
      publicationDate: new Date('2024-09-10T12:40:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/aug-2024',
      rawTextSnippet:
        'UNFPA tracks approximately 4,390 births during August 2024 amid recurrent evacuation orders in Khan Younis.',
      documentRef: 'UNFPA-SR-2024-08',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-09',
      count: 3920,
      publicationDate: new Date('2024-10-14T11:15:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-09',
      rawTextSnippet:
        'September 2024 MOH statistical summary confirms 3,920 recorded live births across active hospitals and clinics.',
      documentRef: 'MOH-MTH-2024-09',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Monthly',
      periodValue: '2024-09',
      count: 4110,
      publicationDate: new Date('2024-10-19T10:00:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/civil-stats/2024-09',
      rawTextSnippet:
        'Mobile civil registration campaigns caught up on prior backlogs, issuing 4,110 certificates dated to September 2024 births.',
      documentRef: 'MOI-MTH-2024-09',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2024-10',
      count: 4290,
      publicationDate: new Date('2024-11-12T16:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-sitrep-238',
      rawTextSnippet:
        'OCHA estimates 4,290 births occurred across Gaza during October 2024, noting severe disruption to northern maternity access.',
      documentRef: 'OCHA-SITREP-238',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-10',
      count: 3740,
      publicationDate: new Date('2024-11-16T14:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-10',
      rawTextSnippet:
        'October 2024 hospital tally stands at 3,740 recorded births; northern governorate figures remain partial pending communications restoration.',
      documentRef: 'MOH-MTH-2024-10-R1',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('Al Jazeera'),
      periodType: 'Monthly',
      periodValue: '2024-10',
      count: 4050,
      publicationDate: new Date('2024-11-08T18:45:00Z'),
      sourceUrl: 'https://www.aljazeera.com/news/2024/11/8/gaza-births-october',
      rawTextSnippet:
        'Local health coordinators interviewed by Al Jazeera cited approximately 4,050 newborns delivered in Gaza in October 2024.',
      documentRef: 'AJE-20241108-DEM',
      confidenceStatus: 'Pending Review',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-11',
      count: 3695,
      publicationDate: new Date('2024-12-13T11:40:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-11',
      rawTextSnippet:
        'November 2024 maternity intake logged 3,695 births across functioning hospitals and NGO birthing centers.',
      documentRef: 'MOH-MTH-2024-11',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2024-11',
      count: 4180,
      publicationDate: new Date('2024-12-10T15:10:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/nov-2024',
      rawTextSnippet:
        'UNFPA projects 4,180 deliveries across Gaza in November 2024, approximately 139 births per day.',
      documentRef: 'UNFPA-SR-2024-11',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-12',
      count: 3825,
      publicationDate: new Date('2025-01-14T10:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-12',
      rawTextSnippet:
        'December 2024 recorded facility births reached 3,825 across Gaza governorates, incorporating mobile midwife registries.',
      documentRef: 'MOH-MTH-2024-12',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2024-12',
      count: 4210,
      publicationDate: new Date('2025-01-11T16:40:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-sitrep-259',
      rawTextSnippet:
        'Health Cluster surveillance estimates 4,210 births in December 2024 amid winter shelter conditions.',
      documentRef: 'OCHA-SITREP-259',
      confidenceStatus: 'Verified',
    },
  ];

  const insertedReports = await db
    .insert(birthReports)
    .values(reportSeedRows)
    .returning();

  const findReportId = (sourceName: string, periodType: string, periodValue: string) => {
    const sId = sid(sourceName);
    const found = insertedReports.find(
      (r) =>
        r.sourceId === sId &&
        r.periodType === periodType &&
        r.periodValue === periodValue
    );
    return found?.id;
  };

  // Multi-step revision audit trail entries
  const revisionSeedRows = [
    {
      birthReportId: findReportId('MOH Gaza', 'Monthly', '2024-03')!,
      previousValue: 4120,
      newValue: 4285,
      changeReason:
        'Integrated delayed paper delivery registers from Al-Awda Hospital (Jabalia) into March tally.',
      detectedAt: new Date('2024-04-08T14:22:00Z'),
      detectedBy: 'Automated Pipeline',
      actorEmail: null,
    },
    {
      birthReportId: findReportId('MOH Gaza', 'Monthly', '2024-03')!,
      previousValue: 4285,
      newValue: 4390,
      changeReason:
        'Updated monthly total published in MOH Bulletin R3 after reconciling Kamal Adwan neonatal logbooks.',
      detectedAt: new Date('2024-04-16T09:45:00Z'),
      detectedBy: 'Manual Override',
      actorEmail: 'demographics.lead@observatory.org',
    },
    {
      birthReportId: findReportId('MOH Gaza', 'Monthly', '2023-10')!,
      previousValue: 4710,
      newValue: 4980,
      changeReason:
        'Post-blackout synchronization added 270 hospital births from Al-Shifa and Indonesian Hospital wards.',
      detectedAt: new Date('2023-11-11T17:50:00Z'),
      detectedBy: 'Manual Override',
      actorEmail: 'demographics.lead@observatory.org',
    },
    {
      birthReportId: findReportId('MOH Gaza', 'Monthly', '2024-01')!,
      previousValue: 4510,
      newValue: 4380,
      changeReason:
        'Deduplicated 130 double-counted transfer admissions between Al-Emirati and Rafah field clinic.',
      detectedAt: new Date('2024-02-14T11:35:00Z'),
      detectedBy: 'Automated Pipeline',
      actorEmail: null,
    },
    {
      birthReportId: findReportId('MOH Gaza', 'Monthly', '2024-05')!,
      previousValue: 3520,
      newValue: 3760,
      changeReason:
        'Added 240 births recorded by relocated midwife teams in Al-Mawasi emergency tents.',
      detectedAt: new Date('2024-06-15T11:05:00Z'),
      detectedBy: 'Automated Pipeline',
      actorEmail: null,
    },
    {
      birthReportId: findReportId('Ministry of Interior', 'Yearly', '2023')!,
      previousValue: 56100,
      newValue: 58420,
      changeReason:
        'Updated annual civil registry total following Q1 2024 backlog entry of November–December 2023 certificates.',
      detectedAt: new Date('2024-02-12T10:20:00Z'),
      detectedBy: 'Manual Override',
      actorEmail: 'tiago.cruz2010@gmail.com',
    },
    {
      birthReportId: findReportId('UN OCHA', 'Monthly', '2024-03')!,
      previousValue: 5100,
      newValue: 4960,
      changeReason:
        'Typo corrected by official bulletin SitRep #151 revising daily estimate from 165 to 160.',
      detectedAt: new Date('2024-04-11T17:12:00Z'),
      detectedBy: 'Automated Pipeline',
      actorEmail: null,
    },
    {
      birthReportId: findReportId('MOH Gaza', 'Monthly', '2024-10')!,
      previousValue: 3590,
      newValue: 3740,
      changeReason:
        'Appended partial Gaza City clinic submissions received via satellite uplink.',
      detectedAt: new Date('2024-11-16T14:35:00Z'),
      detectedBy: 'Automated Pipeline',
      actorEmail: null,
    },
    {
      birthReportId: findReportId('MOH Gaza', 'Yearly', '2024')!,
      previousValue: 47910,
      newValue: 48760,
      changeReason:
        'Preliminary annual consolidation incorporated December mobile clinic deliveries and late Q3 corrections.',
      detectedAt: new Date('2025-02-05T13:18:00Z'),
      detectedBy: 'Manual Override',
      actorEmail: 'tiago.cruz2010@gmail.com',
    },
  ].filter((row) => Boolean(row.birthReportId));

  if (revisionSeedRows.length > 0) {
    await db.insert(dataRevisionLogs).values(revisionSeedRows);
  }

  // Staging Queue items ("Needs Review") showing all 3 dedupe classifications
  const mohDec2024Id = findReportId('MOH Gaza', 'Monthly', '2024-12') ?? null;
  const ochaNov2024Id = findReportId('UNFPA Palestine', 'Monthly', '2024-11') ?? null;

  await db.insert(ingestionStaging).values([
    {
      sourceNameDetected: 'MOH Gaza',
      matchedSourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2024-12',
      extractedCount: 3915,
      publicationDate: new Date('2025-01-28T11:20:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2024-12-addendum',
      rawTextSnippet:
        'Addendum to December 2024 maternity statistics: incorporating 90 previously unlogged deliveries from north Gaza field clinics brings the December total to 3,915 live births.',
      documentRef: 'MOH-MTH-2024-12-ADD1',
      matchClassification: 'Potential Revision',
      relatedReportId: mohDec2024Id,
      reviewStatus: 'Needs Review',
      rawExtractionJson: JSON.stringify(
        {
          period_type: 'Monthly',
          period: '2024-12',
          count: 3915,
          source_date: '2025-01-28',
          suggested_source: 'MOH Gaza',
          document_ref: 'MOH-MTH-2024-12-ADD1',
          snippet:
            'incorporating 90 previously unlogged deliveries from north Gaza field clinics brings the December total to 3,915 live births.',
        },
        null,
        2
      ),
    },
    {
      sourceNameDetected: 'UN OCHA',
      matchedSourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2024-11',
      extractedCount: 4240,
      publicationDate: new Date('2024-12-16T15:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/hostilities-gaza-sitrep-248',
      rawTextSnippet:
        'Humanitarian Situation Update #248 notes approximately 4,240 births recorded or estimated across Gaza during November 2024.',
      documentRef: 'OCHA-SITREP-248',
      matchClassification: 'Alternate Source',
      relatedReportId: ochaNov2024Id,
      reviewStatus: 'Needs Review',
      rawExtractionJson: JSON.stringify(
        {
          period_type: 'Monthly',
          period: '2024-11',
          count: 4240,
          source_date: '2024-12-16',
          suggested_source: 'UN OCHA',
          document_ref: 'OCHA-SITREP-248',
          snippet:
            'Humanitarian Situation Update #248 notes approximately 4,240 births recorded or estimated across Gaza during November 2024.',
        },
        null,
        2
      ),
    },
    {
      sourceNameDetected: 'UNFPA Palestine',
      matchedSourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2025-01',
      extractedCount: 4120,
      publicationDate: new Date('2025-02-09T13:45:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/jan-2025',
      rawTextSnippet:
        'UNFPA Situation Report for January 2025 estimates 4,120 women gave birth across Gaza as mobile maternal units resumed partial access to northern districts.',
      documentRef: 'UNFPA-SR-2025-01',
      matchClassification: 'New Period',
      relatedReportId: null,
      reviewStatus: 'Needs Review',
      rawExtractionJson: JSON.stringify(
        {
          period_type: 'Monthly',
          period: '2025-01',
          count: 4120,
          source_date: '2025-02-09',
          suggested_source: 'UNFPA Palestine',
          document_ref: 'UNFPA-SR-2025-01',
          snippet:
            'UNFPA Situation Report for January 2025 estimates 4,120 women gave birth across Gaza as mobile maternal units resumed partial access.',
        },
        null,
        2
      ),
    },
    {
      sourceNameDetected: 'MOH Official Telegram',
      matchedSourceId: sid('MOH Official Telegram'),
      periodType: 'Monthly',
      periodValue: '2025-01',
      extractedCount: 3860,
      publicationDate: new Date('2025-02-04T19:05:00Z'),
      sourceUrl: 'https://t.me/MOHMediaGaza/6941',
      rawTextSnippet:
        'Preliminary hospital maternity update via Telegram: 3,860 newborns registered at operational Gaza hospitals during January 2025.',
      documentRef: 'TG-MOH-6941',
      matchClassification: 'New Period',
      relatedReportId: null,
      reviewStatus: 'Needs Review',
      rawExtractionJson: JSON.stringify(
        {
          period_type: 'Monthly',
          period: '2025-01',
          count: 3860,
          source_date: '2025-02-04',
          suggested_source: 'MOH Official Telegram',
          document_ref: 'TG-MOH-6941',
          snippet:
            'Preliminary hospital maternity update via Telegram: 3,860 newborns registered at operational Gaza hospitals during January 2025.',
        },
        null,
        2
      ),
    },
  ]);

  await seed2025And2026IfMissing();
}

async function seed2025And2026IfMissing() {
  const existingModern = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(birthReports)
    .where(gte(birthReports.periodValue, '2025'));

  if ((existingModern[0]?.count ?? 0) > 0) {
    return;
  }

  const allSources = await db.select().from(sources);
  const sourceMap = new Map(allSources.map((s) => [s.name, s.id]));
  const sid = (name: string) => {
    const id = sourceMap.get(name);
    if (!id) throw new Error(`Missing source for 2025-2026 seed: ${name}`);
    return id;
  };

  const modernReports = [
    // Yearly Totals (2025 & 2026 Provisional/YTD)
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Yearly',
      periodValue: '2025',
      count: 46940,
      publicationDate: new Date('2026-01-24T11:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/annual-2025-maternity',
      rawTextSnippet:
        'Compiled 2025 hospital and primary maternity clinic registers logged 46,940 live births across Gaza governorates, reflecting gradual restoration of central and northern maternity departments.',
      documentRef: 'MOH-AHR-2025-FINAL',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Yearly',
      periodValue: '2025',
      count: 51120,
      publicationDate: new Date('2026-01-19T14:30:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/publications/gaza-2025-annual-review',
      rawTextSnippet:
        'UNFPA annual demographic assessment estimates 51,120 births across the Gaza Strip in 2025 (~140 daily), factoring in displacement-site midwife deliveries.',
      documentRef: 'UNFPA-PSE-2025-YR',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Yearly',
      periodValue: '2025',
      count: 50400,
      publicationDate: new Date('2026-02-02T16:15:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-humanitarian-annual-2025',
      rawTextSnippet:
        'Health Cluster partners compiled an estimated 50,400 live deliveries across Gaza in calendar year 2025.',
      documentRef: 'OCHA-OPT-2025-SYNTH',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Yearly',
      periodValue: '2025',
      count: 44810,
      publicationDate: new Date('2026-02-11T09:45:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/reports/2025-civil-registry',
      rawTextSnippet:
        'Civil Status offices processed 44,810 birth certificates dated to 2025 births, with mobile civil registration drives ongoing for displaced families.',
      documentRef: 'MOI-CSR-2025-REV1',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Yearly',
      periodValue: '2026',
      count: 40820,
      publicationDate: new Date('2026-11-14T10:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-ytd-october',
      rawTextSnippet:
        'Year-to-date through October 2026, MOH Gaza maternity facilities recorded 40,820 live births across operating hospital and clinic registries (provisional YTD total).',
      documentRef: 'MOH-YTD-2026-Q3Q4',
      confidenceStatus: 'Pending Review',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Yearly',
      periodValue: '2026',
      count: 44350,
      publicationDate: new Date('2026-11-10T15:00:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/gaza-2026-ytd',
      rawTextSnippet:
        'UNFPA year-to-date maternal cohort tracking estimates 44,350 births in Gaza between January and October 2026 (~145 deliveries per day).',
      documentRef: 'UNFPA-YTD-2026-10',
      confidenceStatus: 'Verified',
    },

    // 2025 Monthly Series (Jan – Dec 2025)
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-01',
      count: 3910,
      publicationDate: new Date('2025-02-11T10:20:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-01',
      rawTextSnippet:
        'January 2025 hospital maternity intake recorded 3,910 live births as northern clinic reporting partially resumed.',
      documentRef: 'MOH-MTH-2025-01',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2025-01',
      count: 4290,
      publicationDate: new Date('2025-02-09T13:45:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/jan-2025',
      rawTextSnippet:
        'UNFPA estimates 4,290 women delivered across Gaza in January 2025 across hospital wards and temporary field maternity units.',
      documentRef: 'UNFPA-SR-2025-01',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-02',
      count: 3740,
      publicationDate: new Date('2025-03-12T11:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-02',
      rawTextSnippet:
        'February 2025 (28 days) facility births totaled 3,740 across functioning Gaza hospitals and NGO clinics.',
      documentRef: 'MOH-MTH-2025-02',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2025-02',
      count: 4060,
      publicationDate: new Date('2025-03-09T16:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-274',
      rawTextSnippet:
        'OCHA Health Cluster partners report approximately 4,060 deliveries during February 2025 (~145 births daily).',
      documentRef: 'OCHA-SITREP-274',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-03',
      count: 3985,
      publicationDate: new Date('2025-04-14T09:40:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-03',
      rawTextSnippet:
        'March 2025 reconciled hospital ledgers document 3,985 live births following expansion of rehabilitated obstetric wards.',
      documentRef: 'MOH-MTH-2025-03-R1',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Monthly',
      periodValue: '2025-03',
      count: 3820,
      publicationDate: new Date('2025-04-19T12:15:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/civil-stats/2025-03',
      rawTextSnippet:
        'Civil Status desks issued 3,820 new birth certificates corresponding to March 2025 deliveries.',
      documentRef: 'MOI-MTH-2025-03',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2025-03',
      count: 4340,
      publicationDate: new Date('2025-04-10T15:30:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/mar-2025',
      rawTextSnippet:
        'UNFPA tracks approximately 4,340 deliveries in Gaza during March 2025.',
      documentRef: 'UNFPA-SR-2025-03',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-04',
      count: 3860,
      publicationDate: new Date('2025-05-11T10:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-04',
      rawTextSnippet:
        'April 2025 maternity intake recorded 3,860 live births across central, southern, and northern referral clinics.',
      documentRef: 'MOH-MTH-2025-04',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2025-04',
      count: 4210,
      publicationDate: new Date('2025-05-08T17:10:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-291',
      rawTextSnippet:
        'Humanitarian health partners estimate 4,210 births across Gaza in April 2025.',
      documentRef: 'OCHA-SITREP-291',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-05',
      count: 3920,
      publicationDate: new Date('2025-06-13T11:25:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-05',
      rawTextSnippet:
        'May 2025 hospital registers totaled 3,920 births, including 380 cesarean deliveries supported by mobile surgical teams.',
      documentRef: 'MOH-MTH-2025-05',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2025-05',
      count: 4280,
      publicationDate: new Date('2025-06-10T14:00:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/may-2025',
      rawTextSnippet:
        'UNFPA situation update estimates 4,280 deliveries across Gaza during May 2025.',
      documentRef: 'UNFPA-SR-2025-05',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-06',
      count: 3895,
      publicationDate: new Date('2025-07-12T09:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-06',
      rawTextSnippet:
        'June 2025 verified hospital logs report 3,895 live births across active Gaza facilities.',
      documentRef: 'MOH-MTH-2025-06',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Al Jazeera'),
      periodType: 'Monthly',
      periodValue: '2025-06',
      count: 4150,
      publicationDate: new Date('2025-07-06T18:20:00Z'),
      sourceUrl: 'https://www.aljazeera.com/news/2025/7/6/gaza-maternity-midyear-2025',
      rawTextSnippet:
        'Gaza hospital spokespersons cited approximately 4,150 newborns delivered across the strip in June 2025.',
      documentRef: 'AJE-20250706-MAT',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-07',
      count: 4010,
      publicationDate: new Date('2025-08-14T10:40:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-07',
      rawTextSnippet:
        'July 2025 facility births reached 4,010 following reopening of additional primary care birthing bays in Gaza City.',
      documentRef: 'MOH-MTH-2025-07',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2025-07',
      count: 4320,
      publicationDate: new Date('2025-08-11T16:15:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-312',
      rawTextSnippet:
        'OCHA estimates 4,320 births occurred across Gaza governorates during July 2025.',
      documentRef: 'OCHA-SITREP-312',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-08',
      count: 3960,
      publicationDate: new Date('2025-09-12T11:10:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-08',
      rawTextSnippet:
        'August 2025 maternity departments documented 3,960 live births.',
      documentRef: 'MOH-MTH-2025-08',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2025-08',
      count: 4290,
      publicationDate: new Date('2025-09-09T14:50:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/aug-2025',
      rawTextSnippet:
        'UNFPA estimates 4,290 births in Gaza during August 2025.',
      documentRef: 'UNFPA-SR-2025-08',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-09',
      count: 3940,
      publicationDate: new Date('2025-10-13T10:15:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-09',
      rawTextSnippet:
        'September 2025 MOH monthly bulletin counts 3,940 recorded deliveries across Gaza facilities.',
      documentRef: 'MOH-MTH-2025-09',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Monthly',
      periodValue: '2025-09',
      count: 3875,
      publicationDate: new Date('2025-10-18T09:00:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/civil-stats/2025-09',
      rawTextSnippet:
        'Civil registry branches recorded 3,875 birth certificates dated to September 2025.',
      documentRef: 'MOI-MTH-2025-09',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-10',
      count: 3890,
      publicationDate: new Date('2025-11-12T12:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-10',
      rawTextSnippet:
        'October 2025 hospital maternity registers logged 3,890 live births across Gaza.',
      documentRef: 'MOH-MTH-2025-10',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2025-10',
      count: 4260,
      publicationDate: new Date('2025-11-10T16:30:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-335',
      rawTextSnippet:
        'Health Cluster partners estimate 4,260 newborns delivered across Gaza in October 2025.',
      documentRef: 'OCHA-SITREP-335',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-11',
      count: 3870,
      publicationDate: new Date('2025-12-14T11:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-11',
      rawTextSnippet:
        'November 2025 recorded hospital and clinic births stood at 3,870.',
      documentRef: 'MOH-MTH-2025-11',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2025-11',
      count: 4195,
      publicationDate: new Date('2025-12-10T15:00:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/nov-2025',
      rawTextSnippet:
        'UNFPA estimates 4,195 births in Gaza during November 2025.',
      documentRef: 'UNFPA-SR-2025-11',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2025-12',
      count: 3960,
      publicationDate: new Date('2026-01-13T10:15:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2025-12',
      rawTextSnippet:
        'December 2025 reconciled maternity ledgers register 3,960 live births across Gaza governorates.',
      documentRef: 'MOH-MTH-2025-12',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2025-12',
      count: 4310,
      publicationDate: new Date('2026-01-11T17:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-352',
      rawTextSnippet:
        'OCHA estimates 4,310 births across Gaza in December 2025.',
      documentRef: 'OCHA-SITREP-352',
      confidenceStatus: 'Verified',
    },

    // 2026 Monthly Series (Jan – Oct 2026)
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-01',
      count: 4040,
      publicationDate: new Date('2026-02-12T10:20:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-01',
      rawTextSnippet:
        'January 2026 facility deliveries totaled 4,040 live births across Gaza hospitals and primary care birthing units.',
      documentRef: 'MOH-MTH-2026-01',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2026-01',
      count: 4410,
      publicationDate: new Date('2026-02-09T14:15:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/jan-2026',
      rawTextSnippet:
        'UNFPA estimates 4,410 women gave birth in Gaza during January 2026.',
      documentRef: 'UNFPA-SR-2026-01',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-02',
      count: 3845,
      publicationDate: new Date('2026-03-11T11:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-02',
      rawTextSnippet:
        'February 2026 (28 days) MOH maternity logbooks count 3,845 live births.',
      documentRef: 'MOH-MTH-2026-02',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2026-02',
      count: 4180,
      publicationDate: new Date('2026-03-09T16:40:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-368',
      rawTextSnippet:
        'Health Cluster partners report an estimated 4,180 deliveries in February 2026.',
      documentRef: 'OCHA-SITREP-368',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-03',
      count: 4125,
      publicationDate: new Date('2026-04-14T10:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-03-revised',
      rawTextSnippet:
        'Revised March 2026 maternity summary confirms 4,125 live births after incorporating late NGO field hospital submissions.',
      documentRef: 'MOH-MTH-2026-03-R2',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Monthly',
      periodValue: '2026-03',
      count: 4010,
      publicationDate: new Date('2026-04-18T09:15:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/civil-stats/2026-03',
      rawTextSnippet:
        'Civil Status registries processed 4,010 new birth registrations for March 2026.',
      documentRef: 'MOI-MTH-2026-03',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2026-03',
      count: 4460,
      publicationDate: new Date('2026-04-10T15:10:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/mar-2026',
      rawTextSnippet:
        'UNFPA tracks approximately 4,460 births across Gaza in March 2026.',
      documentRef: 'UNFPA-SR-2026-03',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-04',
      count: 4060,
      publicationDate: new Date('2026-05-12T10:45:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-04',
      rawTextSnippet:
        'April 2026 facility deliveries reached 4,060 across Gaza governorates.',
      documentRef: 'MOH-MTH-2026-04',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2026-04',
      count: 4390,
      publicationDate: new Date('2026-05-09T17:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-384',
      rawTextSnippet:
        'OCHA estimates 4,390 deliveries in Gaza throughout April 2026.',
      documentRef: 'OCHA-SITREP-384',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-05',
      count: 4140,
      publicationDate: new Date('2026-06-13T11:15:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-05',
      rawTextSnippet:
        'May 2026 maternity departments documented 4,140 live births.',
      documentRef: 'MOH-MTH-2026-05',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2026-05',
      count: 4480,
      publicationDate: new Date('2026-06-10T14:20:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/may-2026',
      rawTextSnippet:
        'UNFPA estimates 4,480 births in Gaza during May 2026 (~145 deliveries daily).',
      documentRef: 'UNFPA-SR-2026-05',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-06',
      count: 4085,
      publicationDate: new Date('2026-07-14T10:00:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-06',
      rawTextSnippet:
        'June 2026 recorded facility births reached 4,085 across operational clinics and referral hospitals.',
      documentRef: 'MOH-MTH-2026-06',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Ministry of Interior'),
      periodType: 'Monthly',
      periodValue: '2026-06',
      count: 4195,
      publicationDate: new Date('2026-07-18T11:30:00Z'),
      sourceUrl: 'https://www.moi.gov.ps/civil-stats/2026-06',
      rawTextSnippet:
        'Expanded mobile civil registration units issued 4,195 certificates dated to June 2026 live births.',
      documentRef: 'MOI-MTH-2026-06',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-07',
      count: 4190,
      publicationDate: new Date('2026-08-13T10:20:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-07',
      rawTextSnippet:
        'July 2026 hospital deliveries totaled 4,190 live births across Gaza.',
      documentRef: 'MOH-MTH-2026-07',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2026-07',
      count: 4510,
      publicationDate: new Date('2026-08-10T16:00:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-406',
      rawTextSnippet:
        'OCHA Health Cluster reports an estimated 4,510 births in July 2026.',
      documentRef: 'OCHA-SITREP-406',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-08',
      count: 4155,
      publicationDate: new Date('2026-09-12T09:50:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-08',
      rawTextSnippet:
        'August 2026 verified maternity records show 4,155 live births.',
      documentRef: 'MOH-MTH-2026-08',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2026-08',
      count: 4470,
      publicationDate: new Date('2026-09-09T13:30:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/aug-2026',
      rawTextSnippet:
        'UNFPA estimates 4,470 births across Gaza during August 2026.',
      documentRef: 'UNFPA-SR-2026-08',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-09',
      count: 4090,
      publicationDate: new Date('2026-10-13T11:10:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-09',
      rawTextSnippet:
        'September 2026 hospital and primary clinic logs document 4,090 live births.',
      documentRef: 'MOH-MTH-2026-09',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2026-09',
      count: 4420,
      publicationDate: new Date('2026-10-10T15:45:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-421',
      rawTextSnippet:
        'Humanitarian health partners estimate 4,420 deliveries in Gaza during September 2026.',
      documentRef: 'OCHA-SITREP-421',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-10',
      count: 4090,
      publicationDate: new Date('2026-11-14T10:30:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-10',
      rawTextSnippet:
        'October 2026 reconciled hospital delivery tally stands at 4,090 births across Gaza governorates.',
      documentRef: 'MOH-MTH-2026-10-R1',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('UNFPA Palestine'),
      periodType: 'Monthly',
      periodValue: '2026-10',
      count: 4490,
      publicationDate: new Date('2026-11-10T14:55:00Z'),
      sourceUrl: 'https://palestine.unfpa.org/en/sitrep/oct-2026',
      rawTextSnippet:
        'UNFPA situation report estimates 4,490 women gave birth across Gaza in October 2026.',
      documentRef: 'UNFPA-SR-2026-10',
      confidenceStatus: 'Verified',
    },
    {
      sourceId: sid('Al Jazeera'),
      periodType: 'Monthly',
      periodValue: '2026-10',
      count: 4310,
      publicationDate: new Date('2026-11-06T18:10:00Z'),
      sourceUrl: 'https://www.aljazeera.com/news/2026/11/6/gaza-births-october-2026',
      rawTextSnippet:
        'Hospital directors and local health officials cited approximately 4,310 births across Gaza in October 2026.',
      documentRef: 'AJE-20261106-BTH',
      confidenceStatus: 'Disputed',
    },
    {
      sourceId: sid('MOH Official Telegram'),
      periodType: 'Monthly',
      periodValue: '2026-10',
      count: 3940,
      publicationDate: new Date('2026-11-03T19:40:00Z'),
      sourceUrl: 'https://t.me/MOHMediaGaza/9184',
      rawTextSnippet:
        'Preliminary October 2026 hospital tally via Telegram: 3,940 newborns logged prior to northern clinic reconciliation.',
      documentRef: 'TG-MOH-9184',
      confidenceStatus: 'Superseded',
    },
  ];

  const insertedModern = await db
    .insert(birthReports)
    .values(modernReports)
    .returning();

  const findModernId = (sourceName: string, periodType: string, periodValue: string) => {
    const sId = sid(sourceName);
    return insertedModern.find(
      (r) =>
        r.sourceId === sId &&
        r.periodType === periodType &&
        r.periodValue === periodValue
    )?.id;
  };

  const modernRevisions = [
    {
      birthReportId: findModernId('MOH Gaza', 'Monthly', '2025-03')!,
      previousValue: 3850,
      newValue: 3985,
      changeReason:
        'Added 135 delayed delivery records from newly restored northern primary maternity clinics.',
      detectedAt: new Date('2025-04-14T09:50:00Z'),
      detectedBy: 'Automated Pipeline',
      actorEmail: null,
    },
    {
      birthReportId: findModernId('MOH Gaza', 'Yearly', '2025')!,
      previousValue: 46120,
      newValue: 46940,
      changeReason:
        'Final 2025 annual audit reconciled Q4 NGO birthing center logs and corrected duplicate transfer IDs.',
      detectedAt: new Date('2026-01-24T11:15:00Z'),
      detectedBy: 'Manual Override',
      actorEmail: 'tiago.cruz2010@gmail.com',
    },
    {
      birthReportId: findModernId('MOH Gaza', 'Monthly', '2026-03')!,
      previousValue: 3990,
      newValue: 4125,
      changeReason:
        'Updated March 2026 total in MOH Bulletin R2 after incorporating field hospital maternity sheets.',
      detectedAt: new Date('2026-04-14T10:35:00Z'),
      detectedBy: 'Automated Pipeline',
      actorEmail: null,
    },
    {
      birthReportId: findModernId('MOH Gaza', 'Monthly', '2026-10')!,
      previousValue: 3940,
      newValue: 4090,
      changeReason:
        'Reconciled preliminary Telegram count with final October 2026 northern clinic and Al-Aqsa ward registers.',
      detectedAt: new Date('2026-11-14T10:40:00Z'),
      detectedBy: 'Manual Override',
      actorEmail: 'tiago.cruz2010@gmail.com',
    },
  ].filter((row) => Boolean(row.birthReportId));

  if (modernRevisions.length > 0) {
    await db.insert(dataRevisionLogs).values(modernRevisions);
  }

  // Add current November 2026 candidates into the staging queue
  const mohOct2026Id = findModernId('MOH Gaza', 'Monthly', '2026-10') ?? null;
  await db.insert(ingestionStaging).values([
    {
      sourceNameDetected: 'MOH Gaza',
      matchedSourceId: sid('MOH Gaza'),
      periodType: 'Monthly',
      periodValue: '2026-10',
      extractedCount: 4145,
      publicationDate: new Date('2026-11-22T12:15:00Z'),
      sourceUrl: 'https://www.moh.gov.ps/bulletins/2026-10-addendum',
      rawTextSnippet:
        'October 2026 statistical addendum: adding 55 late midwife-assisted deliveries raises the finalized October 2026 MOH tally to 4,145 live births.',
      documentRef: 'MOH-MTH-2026-10-ADD2',
      matchClassification: 'Potential Revision',
      relatedReportId: mohOct2026Id,
      reviewStatus: 'Needs Review',
      rawExtractionJson: JSON.stringify(
        {
          period_type: 'Monthly',
          period: '2026-10',
          count: 4145,
          source_date: '2026-11-22',
          suggested_source: 'MOH Gaza',
          document_ref: 'MOH-MTH-2026-10-ADD2',
          snippet:
            'adding 55 late midwife-assisted deliveries raises the finalized October 2026 MOH tally to 4,145 live births.',
        },
        null,
        2
      ),
    },
    {
      sourceNameDetected: 'UN OCHA',
      matchedSourceId: sid('UN OCHA'),
      periodType: 'Monthly',
      periodValue: '2026-11',
      extractedCount: 3680,
      publicationDate: new Date('2026-11-24T17:30:00Z'),
      sourceUrl: 'https://www.ochaopt.org/content/gaza-sitrep-439',
      rawTextSnippet:
        'Mid-to-late November 2026 flash update: Health Cluster partners estimate 3,680 live births recorded across Gaza through November 24, 2026.',
      documentRef: 'OCHA-SITREP-439',
      matchClassification: 'New Period',
      relatedReportId: null,
      reviewStatus: 'Needs Review',
      rawExtractionJson: JSON.stringify(
        {
          period_type: 'Monthly',
          period: '2026-11',
          count: 3680,
          source_date: '2026-11-24',
          suggested_source: 'UN OCHA',
          document_ref: 'OCHA-SITREP-439',
          snippet:
            'Health Cluster partners estimate 3,680 live births recorded across Gaza through November 24, 2026.',
        },
        null,
        2
      ),
    },
  ]);
}

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}
