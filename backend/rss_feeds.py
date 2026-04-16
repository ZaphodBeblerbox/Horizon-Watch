"""
Additional RSS feed registry for news-conflict ingestion.
These feeds are appended to the existing in-file scan list in main.py.
"""

# Base list kept as-is from prior expansion.
ADDITIONAL_SCAN_FEEDS = [
    # ----------------
    # GLOBAL
    # ----------------
    ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"),
    ("NYTimes World", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"),
    ("Reuters World", "https://feeds.reuters.com/reuters/worldNews"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
    ("France24", "https://www.france24.com/en/rss"),
    ("DW Top Stories", "https://www.dw.com/en/top-stories/s-9097?maca=en-rss-en-top-1022-rdf"),
    ("Euronews", "https://www.euronews.com/rss"),

    # ----------------
    # MIDDLE EAST
    # ----------------
    ("Arab News", "https://www.arabnews.com/rss.xml"),
    ("Gulf News", "https://gulfnews.com/rss"),
    ("Middle East Eye", "https://www.middleeasteye.net/rss"),
    ("Al Monitor", "https://www.al-monitor.com/rss"),
    ("Times of Israel", "https://www.timesofisrael.com/feed/"),
    ("Haaretz", "https://www.haaretz.com/cmlink/1.628752"),
    ("LBCI Lebanon", "https://www.lbcgroup.tv/Rss/RssFeed/News/en"),
    ("Lebanon24", "https://www.lebanon24.com/rss"),
    ("Al Bawaba", "https://www.albawaba.com/rss"),
    ("Al Arabiya English", "https://english.alarabiya.net/rss.xml"),
    ("Jerusalem Post", "https://www.jpost.com/Rss/RssFeedsHeadlines.aspx"),

    # ----------------
    # AFRICA
    # ----------------
    ("AllAfrica Latest", "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf"),
    ("Nation Africa", "https://nation.africa/rss"),
    ("Daily Monitor Uganda", "https://www.monitor.co.ug/rss"),
    ("The EastAfrican", "https://www.theeastafrican.co.ke/rss"),
    ("Premium Times", "https://www.premiumtimesng.com/feed"),
    ("Guardian Nigeria", "https://guardian.ng/feed"),
    ("News24", "https://www.news24.com/rss"),
    ("Mail & Guardian", "https://mg.co.za/feed"),
    ("Sowetan Live", "https://www.sowetanlive.co.za/rss"),
    ("IOL South Africa", "https://www.iol.co.za/cmlink/1.640"),

    # ----------------
    # EUROPE
    # ----------------
    ("Politico Europe", "https://www.politico.eu/feed/"),
    ("Financial Times", "https://www.ft.com/?format=rss"),
    ("Guardian World", "https://www.theguardian.com/world/rss"),
    ("Sky News World", "https://feeds.skynews.com/feeds/rss/world.xml"),
    ("Le Monde English", "https://www.lemonde.fr/en/rss/une.xml"),
    ("Der Spiegel International", "https://www.spiegel.de/international/index.rss"),
    ("The Local Germany", "https://www.thelocal.de/feed/"),
    ("Euractiv", "https://www.euractiv.com/feed/"),
    ("Swissinfo English", "https://www.swissinfo.ch/eng/rss"),
    ("Balkan Insight", "https://www.balkaninsight.com/feed"),

    # ----------------
    # ASIA
    # ----------------
    ("SCMP", "https://www.scmp.com/rss/91/feed"),
    ("Channel News Asia", "https://www.channelnewsasia.com/rssfeeds/8395986"),
    ("Japan Times", "https://www.japantimes.co.jp/feed/"),
    ("Korea Times", "https://www.koreatimes.co.kr/www/rss/rss.xml"),
    ("Bangkok Post", "https://www.bangkokpost.com/rss/data/topstories.xml"),
    ("Philstar", "https://www.philstar.com/rss/headlines"),
    ("Manila Times", "https://www.manilatimes.net/feed"),
    ("Hindustan Times World", "https://www.hindustantimes.com/feeds/rss/world-news/rssfeed.xml"),
    ("Times of India World", "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms"),

    # ----------------
    # LATIN AMERICA
    # ----------------
    ("teleSUR English", "https://www.telesurenglish.net/rss/index.html"),
    ("Buenos Aires Times", "https://www.batimes.com.ar/rss"),
    ("Rio Times", "https://www.riotimesonline.com/feed/"),
    ("El Universal", "https://www.eluniversal.com/rss/"),
    ("El Tiempo", "https://www.eltiempo.com/rss"),
    ("La Nacion Argentina", "https://www.lanacion.com.ar/arc/outboundfeeds/rss/"),

    # ----------------
    # SECURITY / DEFENSE
    # ----------------
    ("Defense News", "https://www.defensenews.com/arc/outboundfeeds/rss/"),
    ("Military Times", "https://www.militarytimes.com/arc/outboundfeeds/rss/"),
    ("War on the Rocks", "https://www.warontherocks.com/feed/"),
    ("Long War Journal", "https://www.longwarjournal.org/feed"),
    ("RealClearDefense", "https://www.realcleardefense.com/index.xml"),
    ("Janes", "https://www.janes.com/feeds/rss"),

    # ----------------
    # HUMANITARIAN / CONFLICT
    # ----------------
    ("ReliefWeb", "https://reliefweb.int/rss.xml"),
    ("International Crisis Group", "https://www.crisisgroup.org/rss.xml"),

    # ----------------
    # ADDITIONAL — missing from above
    # ----------------
    ("BBC Middle East", "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ("Iran International", "https://www.iranintl.com/en/rss"),
    ("Bellingcat", "https://www.bellingcat.com/feed/"),
    ("ACLED Data", "https://acleddata.com/feed/"),
    ("DW World English", "https://rss.dw.com/rdf/rss-en-world"),
]

# City-specific feeds. Each entry: (source_name, url, country, city, default_lat, default_lon)
# Gate 0 security keyword filter is bypassed for these — Claude scores relevance instead.
LOCAL_CITY_FEEDS = [
    # Paris
    ("Le Parisien", "https://www.leparisien.fr/arc/outboundfeeds/rss/category/paris-75.xml", "France", "Paris", 48.8566, 2.3522),
    ("20 Minutes Paris", "https://www.20minutes.fr/feeds/rss-paris.xml", "France", "Paris", 48.8566, 2.3522),
    ("BFMTV Paris", "https://www.bfmtv.com/paris/rss/", "France", "Paris", 48.8566, 2.3522),
    ("France24 France", "https://www.france24.com/fr/france/rss", "France", "Paris", 48.8566, 2.3522),

    # Berlin
    ("Tagesspiegel Berlin", "https://www.tagesspiegel.de/berlin/feed.rss", "Germany", "Berlin", 52.5200, 13.4050),
    ("Berliner Zeitung", "https://www.berliner-zeitung.de/feed.xml", "Germany", "Berlin", 52.5200, 13.4050),
    ("Berliner Morgenpost", "https://www.morgenpost.de/berlin/rss", "Germany", "Berlin", 52.5200, 13.4050),
    ("RBB24 Berlin", "https://www.rbb24.de/politik/feed.xml", "Germany", "Berlin", 52.5200, 13.4050),
]

_BASE_FEEDS = list(ADDITIONAL_SCAN_FEEDS)

# ----------------
# MIDDLE EAST (+25)
# ----------------
MIDDLE_EAST_EXPANDED_FEEDS = [
    ("The National UAE", "https://www.thenationalnews.com/rss"),
    ("MEMO", "https://www.middleeastmonitor.com/feed/"),
    ("Ahram Online", "https://english.ahram.org.eg/RSS.aspx?SectionID=1"),
    ("Jordan Times", "https://www.jordantimes.com/rss.xml"),
    ("Kuwait Times", "https://www.kuwaittimes.com/feed/"),
    ("Qatar Tribune", "https://www.qatar-tribune.com/rssFeed"),
    ("Qatar News Agency", "https://www.qna.org.qa/en/rss"),
    ("Bahrain News Agency", "https://www.bna.bh/en/rss"),
    ("Times of Oman", "https://timesofoman.com/rss"),
    ("Muscat Daily", "https://muscatdaily.com/feed/"),
    ("Oman Observer", "https://www.omanobserver.om/rss"),
    ("Saudi Gazette", "https://saudigazette.com.sa/rssFeed"),
    ("Anadolu World", "https://www.aa.com.tr/en/rss/default?cat=world"),
    ("Hurriyet Daily News", "https://www.hurriyetdailynews.com/rss"),
    ("TRT World", "https://www.trtworld.com/rss"),
    ("Yeni Safak English", "https://www.yenisafak.com/en/rss"),
    ("Tehran Times", "https://www.tehrantimes.com/rss"),
    ("IRNA English", "https://en.irna.ir/rss"),
    ("Tasnim News", "https://www.tasnimnews.com/en/rss/feed/0/7/0"),
    ("Mehr News", "https://en.mehrnews.com/rss"),
    ("Iraq News", "https://www.iraqinews.com/feed/"),
    ("Rudaw", "https://www.rudaw.net/english/rss"),
    ("Syria Times", "https://syriatimes.sy/feed/"),
    ("SANA Syria", "https://sana.sy/en/?feed=rss2"),
    ("Yemen Online", "https://yemenonline.info/feed/"),
    ("The New Arab", "https://www.newarab.com/rss"),
]

# ----------------
# AFRICA (+25)
# ----------------
AFRICA_EXPANDED_FEEDS = [
    ("AllAfrica East Africa", "https://allafrica.com/tools/headlines/rdf/eastafrica/headlines.rdf"),
    ("AllAfrica West Africa", "https://allafrica.com/tools/headlines/rdf/westafrica/headlines.rdf"),
    ("AllAfrica North Africa", "https://allafrica.com/tools/headlines/rdf/northafrica/headlines.rdf"),
    ("AllAfrica Southern Africa", "https://allafrica.com/tools/headlines/rdf/southernafrica/headlines.rdf"),
    ("AllAfrica Central Africa", "https://allafrica.com/tools/headlines/rdf/centralafrica/headlines.rdf"),
    ("Africa News", "https://www.africanews.com/feed/"),
    ("Africa Intelligence", "https://www.africa-intelligence.com/rss.xml"),
    ("The Africa Report", "https://www.theafricareport.com/feed/"),
    ("Sahara Reporters", "https://saharareporters.com/rss.xml"),
    ("Daily Nation Kenya", "https://nation.africa/kenya/feed"),
    ("The Citizen Tanzania", "https://www.thecitizen.co.tz/rss"),
    ("The Standard Kenya", "https://www.standardmedia.co.ke/rss/headlines.php"),
    ("New Times Rwanda", "https://www.newtimes.co.rw/rss.xml"),
    ("The Reporter Ethiopia", "https://www.thereporterethiopia.com/rss.xml"),
    ("Addis Standard", "https://addisstandard.com/feed/"),
    ("Sudan Tribune", "https://sudantribune.com/feed/"),
    ("Garowe Online", "https://www.garoweonline.com/en/rss"),
    ("Mogadishu Times", "https://mogtimes.com/feed/"),
    ("Mozambique News Agency", "https://aimnews.org/feed/"),
    ("Zambia Daily Mail", "https://www.daily-mail.co.zm/feed/"),
    ("Zimbabwe Herald", "https://www.herald.co.zw/feed/"),
    ("The Namibian", "https://www.namibian.com.na/feed/"),
    ("Botswana Guardian", "https://www.botswanaguardian.co.bw/feed/"),
    ("Lusaka Times", "https://www.lusakatimes.com/feed/"),
    ("Malawi24", "https://malawi24.com/feed/"),
    ("Capital FM Kenya", "https://www.capitalfm.co.ke/news/feed/"),
]

# ----------------
# EUROPE (+25)
# ----------------
EUROPE_EXPANDED_FEEDS = [
    ("BBC Europe", "https://feeds.bbci.co.uk/news/world/europe/rss.xml"),
    ("Reuters Europe", "https://feeds.reuters.com/Reuters/worldNews"),
    ("Euronews Europe", "https://www.euronews.com/rss?level=theme&name=europe"),
    ("Deutsche Welle Europe", "https://rss.dw.com/rdf/rss-en-eu"),
    ("France24 Europe", "https://www.france24.com/en/europe/rss"),
    ("El Pais English", "https://english.elpais.com/rss/english.xml"),
    ("ANSA English", "https://www.ansa.it/english/news/general_news/rss.xml"),
    ("The Portugal News", "https://www.theportugalnews.com/rss"),
    ("The Local Spain", "https://www.thelocal.es/feed/"),
    ("The Local France", "https://www.thelocal.fr/feed/"),
    ("The Local Italy", "https://www.thelocal.it/feed/"),
    ("The Local Sweden", "https://www.thelocal.se/feed/"),
    ("The Local Norway", "https://www.thelocal.no/feed/"),
    ("EUobserver", "https://euobserver.com/rss"),
    ("EU Reporter", "https://www.eureporter.co/feed/"),
    ("Kyiv Independent", "https://kyivindependent.com/rss"),
    ("Ukrinform", "https://www.ukrinform.net/rss/block-lastnews"),
    ("BNE IntelliNews", "https://www.intellinews.com/rss/"),
    ("Balkan Insight News", "https://balkaninsight.com/feed/"),
    ("Prague Morning", "https://www.praguemorning.cz/feed/"),
    ("Warsaw Point", "https://tvpworld.com/rss"),
    ("ERR News", "https://news.err.ee/rss"),
    ("Yle News", "https://feeds.yle.fi/uutiset/v1/recent.rss?publisherIds=YLE_UUTISET"),
    ("Swissinfo International", "https://www.swissinfo.ch/eng/rss"),
    ("Irish Times World", "https://www.irishtimes.com/feeds/world"),
    ("The Times UK World", "https://www.thetimes.co.uk/world/rss"),
]

# ----------------
# ASIA (+25)
# ----------------
ASIA_EXPANDED_FEEDS = [
    ("Nikkei Asia", "https://asia.nikkei.com/rss/feed/nar"),
    ("The Straits Times", "https://www.straitstimes.com/news/asia/rss.xml"),
    ("Jakarta Post", "https://www.thejakartapost.com/rss"),
    ("Bangkok Post World", "https://www.bangkokpost.com/rss/data/world.xml"),
    ("VN Express", "https://e.vnexpress.net/rss/news.rss"),
    ("Vietnam News", "https://vietnamnews.vn/rss/world.rss"),
    ("The Diplomat", "https://thediplomat.com/feed/"),
    ("Pakistan Dawn", "https://www.dawn.com/feeds/home"),
    ("The News Pakistan", "https://www.thenews.com.pk/rss/1/1"),
    ("Tribune Pakistan", "https://tribune.com.pk/feed/"),
    ("Economic Times World", "https://economictimes.indiatimes.com/rssfeeds/1208665.cms"),
    ("Hindu World", "https://www.thehindu.com/news/international/feeder/default.rss"),
    ("Indian Express World", "https://indianexpress.com/section/world/feed/"),
    ("Hindustan Times India", "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml"),
    ("Global Times", "https://www.globaltimes.cn/rss/outbrain.xml"),
    ("China Daily", "https://www.chinadaily.com.cn/rss/world_rss.xml"),
    ("CNA Taiwan", "https://focustaiwan.tw/rss/aall.xml"),
    ("Taipei Times", "https://www.taipeitimes.com/rss/rss.xml"),
    ("KBS World", "https://world.kbs.co.kr/rss/rss_news.htm?lang=e"),
    ("Yonhap News", "https://en.yna.co.kr/RSS/news.xml"),
    ("NHK World", "https://www3.nhk.or.jp/rss/news/cat0.xml"),
    ("Mainichi", "https://mainichi.jp/rss/etc/mainichi-flash.rss"),
    ("Mongolia News", "https://montsame.mn/en/rss"),
    ("The Irrawaddy", "https://www.irrawaddy.com/feed"),
    ("Rappler", "https://www.rappler.com/rss/"),
    ("Philippine Inquirer", "https://globalnation.inquirer.net/feed"),
]

# ----------------
# AMERICAS (+25)
# ----------------
AMERICAS_EXPANDED_FEEDS = [
    ("AP Top News", "https://apnews.com/hub/ap-top-news?output=1"),
    ("NPR World", "https://feeds.npr.org/1004/rss.xml"),
    ("CBC World", "https://www.cbc.ca/cmlink/rss-world"),
    ("Global News World", "https://globalnews.ca/world/feed/"),
    ("CTV World", "https://www.ctvnews.ca/rss/ctvnews-ca-world-public-rss-1.822289"),
    ("US News World", "https://www.usnews.com/rss/news"),
    ("Miami Herald World", "https://www.miamiherald.com/news/nation-world/world/index.rss"),
    ("LA Times World", "https://www.latimes.com/world-nation/rss2.0.xml"),
    ("Washington Times World", "https://www.washingtontimes.com/rss/headlines/news/world/"),
    ("New York Post World", "https://nypost.com/world-news/feed/"),
    ("Telemundo Noticias", "https://www.telemundo.com/noticias/rss"),
    ("Univision Noticias", "https://www.univision.com/rss/noticias.xml"),
    ("Infobae", "https://www.infobae.com/arc/outboundfeeds/rss/"),
    ("Clarin Mundo", "https://www.clarin.com/rss/mundo/"),
    ("Pagina12 El Mundo", "https://www.pagina12.com.ar/rss/secciones/el-mundo/notas"),
    ("El Comercio Peru", "https://elcomercio.pe/feed/"),
    ("RPP Noticias", "https://rpp.pe/rss"),
    ("La Republica Peru", "https://larepublica.pe/arc/outboundfeeds/rss/"),
    ("El Universo Ecuador", "https://www.eluniverso.com/arc/outboundfeeds/rss/"),
    ("MercoPress", "https://en.mercopress.com/rss"),
    ("Brasil247", "https://www.brasil247.com/feed"),
    ("O Globo", "https://oglobo.globo.com/rss.xml"),
    ("Folha", "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml"),
    ("Excelsior Mexico", "https://www.excelsior.com.mx/rss.xml"),
    ("Milenio", "https://www.milenio.com/rss"),
    ("El Universal Mexico", "https://www.eluniversal.com.mx/rss.xml"),
]

# ----------------
# GLOBAL WIRES / BUSINESS / ENERGY / SECURITY (+30)
# ----------------
GLOBAL_EXPANDED_FEEDS = [
    ("Reuters Business", "https://feeds.reuters.com/reuters/businessNews"),
    ("Reuters Energy", "https://feeds.reuters.com/reuters/environment"),
    ("Reuters Top News", "https://feeds.reuters.com/reuters/topNews"),
    ("Bloomberg Politics", "https://feeds.bloomberg.com/politics/news.rss"),
    ("Bloomberg Markets", "https://feeds.bloomberg.com/markets/news.rss"),
    ("WSJ World", "https://feeds.a.dj.com/rss/RSSWorldNews.xml"),
    ("WSJ Markets", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"),
    ("CNBC World", "https://www.cnbc.com/id/100727362/device/rss/rss.html"),
    ("CNBC Energy", "https://www.cnbc.com/id/19854910/device/rss/rss.html"),
    ("Financial Times World", "https://www.ft.com/world?format=rss"),
    ("Financial Times Energy", "https://www.ft.com/energy?format=rss"),
    ("MarketWatch Top", "https://feeds.marketwatch.com/marketwatch/topstories/"),
    ("Yahoo Finance News", "https://finance.yahoo.com/news/rssindex"),
    ("OilPrice", "https://oilprice.com/rss/main"),
    ("Rigzone", "https://www.rigzone.com/news/rss/"),
    ("Energy Voice", "https://www.energyvoice.com/feed/"),
    ("Offshore Technology", "https://www.offshore-technology.com/feed/"),
    ("Maritime Executive", "https://maritime-executive.com/rss/news"),
    ("Lloyds List", "https://lloydslist.maritimeintelligence.informa.com/rss"),
    ("GCaptain", "https://gcaptain.com/feed/"),
    ("Defense One", "https://www.defenseone.com/rss/all/"),
    ("Breaking Defense", "https://breakingdefense.com/feed/"),
    ("National Interest", "https://nationalinterest.org/rss.xml"),
    ("War Zone", "https://www.twz.com/feed"),
    ("Jamestown Foundation", "https://jamestown.org/feed/"),
    ("CSIS", "https://www.csis.org/rss"),
    ("Chatham House", "https://www.chathamhouse.org/rss.xml"),
    ("Carnegie Endowment", "https://carnegieendowment.org/rss"),
    ("Atlantic Council", "https://www.atlanticcouncil.org/feed/"),
    ("Council on Foreign Relations", "https://www.cfr.org/rss"),
    ("Modern Diplomacy", "https://moderndiplomacy.eu/feed/"),
    ("The Conversation World", "https://theconversation.com/global/articles.atom"),
    ("UN OCHA", "https://www.unocha.org/rss.xml"),
    ("Human Rights Watch", "https://www.hrw.org/rss/news"),
    ("Amnesty International", "https://www.amnesty.org/en/latest/rss/"),
]

# ----------------
# SPACE / AEROSPACE
# ----------------
SPACE_FEEDS = [
    ("SpaceNews",          "https://spacenews.com/feed/"),
    ("NASASpaceflight",    "https://www.nasaspaceflight.com/feed/"),
    ("Ars Technica Space", "https://arstechnica.com/tag/space/feed/"),
    ("Space.com",          "https://www.space.com/feeds/all"),
    ("Universe Today",     "https://www.universetoday.com/feed/"),
]

# ─────────────────────────────────────────────────────────────────────────────
# EXPANDED SPACEFLIGHT FEEDS (40+ sources for /api/news/spaceflight endpoint)
# ─────────────────────────────────────────────────────────────────────────────
SPACEFLIGHT_FEEDS = [
    # Major space news
    {"url": "https://spacenews.com/feed/",                               "name": "SpaceNews"},
    {"url": "https://www.space.com/feeds/all",                           "name": "Space.com"},
    {"url": "https://www.nasaspaceflight.com/feed/",                     "name": "NASASpaceflight"},
    {"url": "https://arstechnica.com/space/feed/",                       "name": "Ars Technica Space"},
    {"url": "https://www.universetoday.com/feed/",                       "name": "Universe Today"},
    {"url": "https://www.planetary.org/feed",                            "name": "Planetary Society"},
    {"url": "https://spaceflightnow.com/feed/",                          "name": "Spaceflight Now"},
    {"url": "https://www.teslarati.com/category/spacex/feed/",           "name": "Teslarati SpaceX"},
    {"url": "https://everydayastronaut.com/feed/",                       "name": "Everyday Astronaut"},
    {"url": "https://www.spacepolicyonline.com/feed",                    "name": "Space Policy Online"},
    # Agency feeds
    {"url": "https://www.nasa.gov/rss/dyn/breaking_news.rss",            "name": "NASA Breaking"},
    {"url": "https://blogs.nasa.gov/spacestation/feed/",                 "name": "NASA ISS Blog"},
    {"url": "https://www.esa.int/rssfeed/Our_Activities/Space_News",     "name": "ESA News"},
    {"url": "https://www.esa.int/rssfeed/Our_Activities/Human_and_Robotic_Exploration", "name": "ESA Exploration"},
    {"url": "https://www.isro.gov.in/rss-feed.xml",                      "name": "ISRO"},
    # Commercial
    {"url": "https://www.cnbc.com/id/10000108/device/rss/rss.html",      "name": "CNBC Space"},
    {"url": "https://techcrunch.com/tag/space/feed/",                    "name": "TechCrunch Space"},
    {"url": "https://www.theverge.com/space/rss/index.xml",              "name": "The Verge Space"},
    # Science & astronomy
    {"url": "https://www.sciencedaily.com/rss/space_time.xml",           "name": "ScienceDaily Space"},
    {"url": "https://phys.org/rss-feed/space-news/",                     "name": "Phys.org Space"},
    {"url": "https://skyandtelescope.org/feed/",                         "name": "Sky & Telescope"},
    {"url": "https://www.astronomy.com/feed/",                           "name": "Astronomy Magazine"},
    {"url": "https://www.newscientist.com/subject/space/feed/",          "name": "New Scientist Space"},
    {"url": "https://www.scientificamerican.com/space/feed/",            "name": "Scientific American Space"},
    {"url": "https://www.nature.com/natastron.rss",                      "name": "Nature Astronomy"},
    # Satellite & industry
    {"url": "https://www.satellitetoday.com/feed/",                      "name": "Satellite Today"},
    {"url": "https://www.geekwire.com/space/feed/",                      "name": "GeekWire Space"},
    {"url": "https://europeanspaceflight.com/feed/",                     "name": "European Spaceflight"},
    {"url": "https://tlpnetwork.com/feed/",                              "name": "TLP Network"},
    # Military space
    {"url": "https://breakingdefense.com/tag/space/feed/",               "name": "Breaking Defense Space"},
    {"url": "https://thespacereview.com/rss.xml",                        "name": "The Space Review"},
    {"url": "https://spacenews.com/section/civil-space/feed/",           "name": "SpaceNews Civil"},
    {"url": "https://spacenews.com/section/military-space/feed/",        "name": "SpaceNews Military"},
    # Analysis
    {"url": "https://spacenews.com/section/launch/feed/",                "name": "SpaceNews Launch"},
    {"url": "https://spacenews.com/section/satellite-telecom/feed/",     "name": "SpaceNews Satellite"},
    {"url": "https://www.nasaspaceflight.com/category/spacex/feed/",     "name": "NSF SpaceX"},
    {"url": "https://www.nasaspaceflight.com/category/nasa/feed/",       "name": "NSF NASA"},
    {"url": "https://www.nasaspaceflight.com/category/ula/feed/",        "name": "NSF ULA"},
    {"url": "https://www.nasaspaceflight.com/category/blue-origin/feed/","name": "NSF Blue Origin"},
    {"url": "https://www.nasaspaceflight.com/category/rocketlab/feed/",  "name": "NSF Rocket Lab"},
]

# ─────────────────────────────────────────────────────────────────────────────
# CITY-SPECIFIC FEEDS (for /api/news/city/{city} endpoint)
# Do NOT feed into the main security scan — these are served directly on demand.
# ─────────────────────────────────────────────────────────────────────────────
CITY_FEEDS = {
    "Paris": {
        "country": "France", "lat": 48.8566, "lon": 2.3522, "language": "fr",
        "feeds": [
            {"url": "https://www.france24.com/en/france/rss",                                        "tier": "international", "lang": "en"},
            {"url": "https://www.rfi.fr/en/france/rss",                                              "tier": "international", "lang": "en"},
            {"url": "https://www.thelocal.fr/feed",                                                  "tier": "regional",      "lang": "en"},
            {"url": "https://www.leparisien.fr/arc/outboundfeeds/rss/category/paris-75.xml",         "tier": "local",         "lang": "fr"},
            {"url": "https://www.20minutes.fr/feeds/rss-paris.xml",                                  "tier": "local",         "lang": "fr"},
            {"url": "https://actu.fr/ile-de-france/paris_75056/feed",                                "tier": "local",         "lang": "fr"},
            {"url": "https://www.bfmtv.com/paris/rss/",                                              "tier": "local",         "lang": "fr"},
            {"url": "https://www.francebleu.fr/rss/paris.xml",                                       "tier": "local",         "lang": "fr"},
            {"url": "https://www.lemonde.fr/paris/rss_full.xml",                                     "tier": "local",         "lang": "fr"},
            {"url": "https://www.lefigaro.fr/rss/figaro_paris.xml",                                  "tier": "local",         "lang": "fr"},
            {"url": "https://www.cnews.fr/rss/une",                                                  "tier": "local",         "lang": "fr"},
            {"url": "https://www.lexpress.fr/rss/alaune.xml",                                        "tier": "regional",      "lang": "fr"},
        ],
    },
    "Berlin": {
        "country": "Germany", "lat": 52.5200, "lon": 13.4050, "language": "de",
        "feeds": [
            {"url": "https://www.dw.com/en/germany/s-1432/rss",                                      "tier": "international", "lang": "en"},
            {"url": "https://www.thelocal.de/feed",                                                  "tier": "regional",      "lang": "en"},
            {"url": "https://www.exberliner.com/feed/",                                              "tier": "local",         "lang": "en"},
            {"url": "https://www.tagesspiegel.de/berlin/feed.rss",                                   "tier": "local",         "lang": "de"},
            {"url": "https://www.berliner-zeitung.de/feed.xml",                                      "tier": "local",         "lang": "de"},
            {"url": "https://www.morgenpost.de/berlin/rss",                                          "tier": "local",         "lang": "de"},
            {"url": "https://www.rbb24.de/politik/feed.xml",                                         "tier": "local",         "lang": "de"},
            {"url": "https://www.bz-berlin.de/feed",                                                 "tier": "local",         "lang": "de"},
            {"url": "https://www.rbb24.de/panorama/feed.xml",                                        "tier": "local",         "lang": "de"},
            {"url": "https://taz.de/Berlin/!p5065/;rss/",                                            "tier": "local",         "lang": "de"},
        ],
    },
    "Dubai": {
        "country": "UAE", "lat": 25.2048, "lon": 55.2708, "language": "en",
        "feeds": [
            {"url": "https://www.thenationalnews.com/rss",                                           "tier": "regional",      "lang": "en"},
            {"url": "https://gulfnews.com/rss",                                                      "tier": "regional",      "lang": "en"},
            {"url": "https://www.khaleejtimes.com/rss",                                              "tier": "regional",      "lang": "en"},
            {"url": "https://www.arabianbusiness.com/rss",                                           "tier": "regional",      "lang": "en"},
            {"url": "https://gulfbusiness.com/feed/",                                                "tier": "regional",      "lang": "en"},
            {"url": "https://www.emirates247.com/rss",                                               "tier": "local",         "lang": "en"},
            {"url": "https://www.zawya.com/en/rss",                                                  "tier": "regional",      "lang": "en"},
            {"url": "https://www.albawaba.com/rss.xml",                                              "tier": "regional",      "lang": "en"},
            {"url": "https://www.middleeasteye.net/rss",                                             "tier": "regional",      "lang": "en"},
            {"url": "https://english.alarabiya.net/tools/rss",                                       "tier": "regional",      "lang": "en"},
        ],
    },
    "Dakar": {
        "country": "Senegal", "lat": 14.7167, "lon": -17.4677, "language": "fr",
        "feeds": [
            {"url": "https://www.seneweb.com/news/rss",                                              "tier": "local",         "lang": "fr"},
            {"url": "https://www.dakaractu.com/feed/",                                               "tier": "local",         "lang": "fr"},
            {"url": "https://www.lequotidien.sn/feed/",                                              "tier": "local",         "lang": "fr"},
            {"url": "https://www.senenews.com/feed/",                                                "tier": "local",         "lang": "fr"},
            {"url": "https://www.pressafrik.com/feed/",                                              "tier": "local",         "lang": "fr"},
            {"url": "https://www.emedia.sn/feed/",                                                   "tier": "local",         "lang": "fr"},
            {"url": "https://www.lesoleil.sn/feed/",                                                 "tier": "local",         "lang": "fr"},
            {"url": "https://www.sudonline.sn/feed/",                                                "tier": "local",         "lang": "fr"},
            {"url": "https://www.jeuneafrique.com/pays/senegal/feed/",                               "tier": "regional",      "lang": "fr"},
            {"url": "https://www.rfi.fr/fr/afrique/rss",                                             "tier": "international", "lang": "fr"},
        ],
    },
    "Hannover": {
        "country": "Germany", "lat": 52.3759, "lon": 9.7320, "language": "de",
        "feeds": [
            {"url": "https://www.haz.de/rss",                                                        "tier": "local",         "lang": "de"},
            {"url": "https://www.neuepresse.de/rss",                                                 "tier": "local",         "lang": "de"},
            {"url": "https://www.ndr.de/nachrichten/niedersachsen/hannover_weser-leinegebiet/index-rss.xml", "tier": "local", "lang": "de"},
            {"url": "https://www.hannover.de/Aktuelles/feed.rss",                                    "tier": "local",         "lang": "de"},
            {"url": "https://www.heise.de/rss/heise.rdf",                                            "tier": "local",         "lang": "de"},
            {"url": "https://www.niedersachsen.de/presseinformationen/feed.rss",                     "tier": "regional",      "lang": "de"},
            {"url": "https://www.dw.com/en/germany/s-1432/rss",                                      "tier": "international", "lang": "en"},
        ],
    },
    "Magdeburg": {
        "country": "Germany", "lat": 52.1205, "lon": 11.6276, "language": "de",
        "feeds": [
            {"url": "https://www.volksstimme.de/feed.rss",                                           "tier": "local",         "lang": "de"},
            {"url": "https://www.mdr.de/nachrichten/sachsen-anhalt/magdeburg/index-rss.xml",         "tier": "local",         "lang": "de"},
            {"url": "https://www.ndr.de/nachrichten/sachsen-anhalt/index-rss.xml",                   "tier": "regional",      "lang": "de"},
            {"url": "https://www.generalanzeiger-magdeburg.de/feed/",                                "tier": "local",         "lang": "de"},
            {"url": "https://www.sachsen-anhalt.de/rss/",                                            "tier": "regional",      "lang": "de"},
            {"url": "https://www.tag24.de/magdeburg/feed",                                           "tier": "local",         "lang": "de"},
            {"url": "https://www.dw.com/en/germany/s-1432/rss",                                      "tier": "international", "lang": "en"},
        ],
    },
}

# ── Stock / Markets feeds ─────────────────────────────────────────────────────
STOCK_FEEDS = [
    # Major wire / broadcast
    {"url": "https://feeds.bloomberg.com/markets/news.rss",                                   "name": "Bloomberg Markets"},
    {"url": "https://www.cnbc.com/id/10000664/device/rss/rss.html",                           "name": "CNBC Finance"},
    {"url": "https://www.cnbc.com/id/10001147/device/rss/rss.html",                           "name": "CNBC Economy"},
    {"url": "https://www.cnbc.com/id/15839069/device/rss/rss.html",                           "name": "CNBC Markets"},
    {"url": "https://feeds.reuters.com/reuters/businessNews",                                  "name": "Reuters Business"},
    {"url": "https://feeds.reuters.com/news/wealth",                                           "name": "Reuters Wealth"},
    {"url": "https://www.ft.com/rss/home/uk",                                                  "name": "Financial Times"},
    {"url": "https://feeds.marketwatch.com/marketwatch/topstories/",                           "name": "MarketWatch Top Stories"},
    {"url": "https://feeds.marketwatch.com/marketwatch/marketpulse/",                          "name": "MarketWatch Pulse"},
    # Equity / analysis
    {"url": "https://www.wsj.com/xml/rss/3_7031.xml",                                          "name": "WSJ Markets"},
    {"url": "https://www.wsj.com/xml/rss/3_7014.xml",                                          "name": "WSJ Business"},
    {"url": "https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline",     "name": "Investopedia"},
    {"url": "https://seekingalpha.com/feed.xml",                                               "name": "Seeking Alpha"},
    {"url": "https://finance.yahoo.com/news/rssindex",                                         "name": "Yahoo Finance News"},
    {"url": "https://www.barrons.com/xml/rss/3_7566.xml",                                      "name": "Barron's"},
    # Commodities / energy
    {"url": "https://oilprice.com/rss/main",                                                   "name": "OilPrice"},
    {"url": "https://www.mining.com/feed/",                                                    "name": "Mining.com"},
    {"url": "https://www.spglobal.com/commodityinsights/en/rss-feed/natural-gas",              "name": "S&P Commodity Insights"},
    # Crypto
    {"url": "https://www.coindesk.com/arc/outboundfeeds/rss/",                                 "name": "CoinDesk"},
    {"url": "https://cointelegraph.com/rss",                                                   "name": "CoinTelegraph"},
    {"url": "https://decrypt.co/feed",                                                         "name": "Decrypt"},
    # Regional / international
    {"url": "https://www.arabianbusiness.com/rss/finance-economics.xml",                       "name": "Arabian Business Finance"},
    {"url": "https://www.scmp.com/rss/5/feed",                                                 "name": "SCMP Business"},
    {"url": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",            "name": "Economic Times Markets"},
    {"url": "https://www.businesslive.co.za/rss",                                              "name": "BusinessLive SA"},
    # Central banks / institutions
    {"url": "https://www.ecb.europa.eu/rss/press.html",                                       "name": "ECB Press"},
    {"url": "https://www.federalreserve.gov/feeds/press_all.xml",                              "name": "Federal Reserve"},
    {"url": "https://www.imf.org/external/rss/feeds.aspx?category=pressreleases",             "name": "IMF Press"},
    {"url": "https://www.worldbank.org/en/news/rss.xml",                                      "name": "World Bank"},
    # Alternative / macro
    {"url": "https://feeds.feedburner.com/zerohedge/feed",                                    "name": "ZeroHedge"},
    {"url": "https://www.tradingview.com/news/rss/",                                           "name": "TradingView"},
]


# Append without removing existing items.
ADDITIONAL_SCAN_FEEDS.extend(
    MIDDLE_EAST_EXPANDED_FEEDS
    + AFRICA_EXPANDED_FEEDS
    + EUROPE_EXPANDED_FEEDS
    + ASIA_EXPANDED_FEEDS
    + AMERICAS_EXPANDED_FEEDS
    + GLOBAL_EXPANDED_FEEDS
    + SPACE_FEEDS
)


def _infer_region_from_source(source_name: str) -> str:
    s = (source_name or "").lower()
    if any(k in s for k in ("east africa", "kenya", "uganda", "tanzania", "rwanda", "burundi", "somalia", "ethiopia", "sudan")):
        return "east_africa"
    if any(k in s for k in ("africa", "allafrica")):
        return "africa"
    if any(k in s for k in ("arab", "israel", "jerusalem", "tehran", "lebanon", "gulf", "middle east", "turkey", "qatar", "oman", "saudi", "syria", "iraq", "yemen", "iran")):
        return "middle_east"
    if any(k in s for k in ("europe", "eu", "balkan", "kyiv", "ukrain", "france", "germany", "swiss", "italy", "spain", "norway", "sweden")):
        return "europe"
    if any(k in s for k in ("asia", "india", "china", "japan", "korea", "thai", "vietnam", "taiwan", "philippine", "pakistan", "indonesia", "myanmar")):
        return "asia"
    if any(k in s for k in ("america", "canada", "mexico", "brazil", "argentina", "peru", "colombia", "chile", "ecuador", "miami", "washington", "npr", "cbc", "ctv")):
        return "americas"
    return "global"


RSS_FEED_META: dict[str, dict[str, str]] = {}


def _register_region(feeds: list[tuple[str, str]], region: str) -> None:
    for source_name, feed_url in feeds:
        if not feed_url:
            continue
        RSS_FEED_META.setdefault(feed_url, {"region": region, "source": source_name})


_register_region(_BASE_FEEDS, "global")
for source_name, feed_url in _BASE_FEEDS:
    if feed_url in RSS_FEED_META:
        RSS_FEED_META[feed_url]["region"] = _infer_region_from_source(source_name)

_register_region(MIDDLE_EAST_EXPANDED_FEEDS, "middle_east")
_register_region(AFRICA_EXPANDED_FEEDS, "africa")
_register_region(EUROPE_EXPANDED_FEEDS, "europe")
_register_region(ASIA_EXPANDED_FEEDS, "asia")
_register_region(AMERICAS_EXPANDED_FEEDS, "americas")
_register_region(GLOBAL_EXPANDED_FEEDS, "global")
_register_region(SPACE_FEEDS, "space")
