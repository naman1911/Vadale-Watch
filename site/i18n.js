// English and Marathi text for the website.
// Marathi was machine-assisted: please have a native speaker check it.
window.I18N = {
  en: {
    title: "Vadale Lake Watch",
    subtitle: "Tracking invasive weed on Vadale Talao, Old Panvel, from space",
    badge: "Satellite estimate",
    banner: "All numbers on this page are estimates from 10 m satellite pixels, not ground measurements.",
    key_weed: "Weed",
    key_water: "Open water",
    key_mud: "Mud / bare",
    key_hidden: "Hidden by cloud",
    right_now: "Right now",
    on_date: (d) => `On ${d}`,
    latest_image: (d) => `Latest satellite image: ${d}`,
    p_what: "of the lake is covered by weed",
    to_latest: "Back to latest",
    swipe_hint: "Swipe to see earlier dates",
    gap_short: "no clear images",
    p_note: "Each square on the map is a 10 m satellite pixel.",
    layer_btn_weed: "Weed",
    layer_btn_photo: "Photo",
    scroll_cue: "Scroll for the full story",
    visible_short: (v) => `${v}% of lake visible`,
    stat_cover: "Weed cover now",
    stat_change: "Change since September 2025",
    stat_water: "Open water left",
    range: (lo, hi) => `likely between ${lo}% and ${hi}%`,
    range_short: (lo, hi) => `likely ${lo}–${hi}%`,
    image_of: (d) => `Satellite image of ${d}`,
    visible_note: (v) => `${v}% of the lake visible; the rest hidden by cloud or haze`,
    change_pts: "percentage points",
    change_detail: (a, d0, b) => `from ${a}% on ${d0} to ${b}% now`,
    change_none: "Not enough clear images yet",
    water_of: (a) => `of ${a} ha total lake area`,
    checked: (d, n) => `Last satellite check: ${d}. ${n} images examined; cloudy ones are skipped.`,
    next_passes: (d) => `Next satellite passes (about 11 am, if not cloudy): ${d}.`,
    takeaway: (a, ma, b, mb, up) => `Weed went from <b>${a}%</b> in ${ma} to <b class="${up ? "up" : "down"}">${b}%</b> in ${mb} ${up ? "▲" : "▼"}`,
    takeaway_worst: (m, v, y) => `This ${m} (<b class="up">${v}%</b>) is the worst ${m} since ${y}.`,
    takeaway_best: (m, v, y) => `This ${m} (<b class="down">${v}%</b>) is the best ${m} since ${y}.`,
    takeaway_range: (my, v, m, lo, hi) => `${my}: <b>${v}%</b> weed. In earlier years, ${m} ranged from ${lo}% to ${hi}%.`,
    detail: (m, v, n, lo, hi) => `${m}: about ${v}% weed, the typical value of ${n} clear image${n === 1 ? "" : "s"} (they ranged ${lo}–${hi}%).`,
    detail_none: (m) => `${m}: no clear satellite images (usually monsoon clouds).`,
    detail_flag: (m) => `${m}: only low-confidence images (lake partly dry, or haze), so no figure is shown.`,
    months_short: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
    chart_title: "Weed cover over time",
    range_campaign: "Since Sep 2025",
    range_years: "Year by year",
    chart_note: "Each bar is one month: green = how much of the lake was covered by weed (the typical value of that month's clear satellite images), blue = open water. ☁ = no clear images that month, usually monsoon clouds. Tap a bar for details.",
    chart_note_years: "Each square is one month; darker green = more weed. ☁ = no clear images (monsoon clouds). ? = only low-confidence images (lake partly dry, or haze). Tap a square for details.",
    table_toggle: "Show all numbers as a table",
    th_date: "Date", th_weed: "Weed %", th_range: "Range", th_water: "Open water (ha)", th_visible: "Lake visible",
    th_note: "Note",
    flag_lake_bed_exposed: "lake partly dry (exposed lake bed), weed % not meaningful",
    flag_wide_range: "unreliable (haze or very thin weed)",
    csv: "Download the data (CSV)",
    compare_title: "Before / after",
    compare_before: "Before",
    compare_after: "After",
    compare_note: "Drag the slider. Each square is one 10 m × 10 m satellite pixel.",
    share_title: "Share the latest numbers",
    share_text: "Download a ready-made 1080×1080 image for Instagram with today's satellite estimate.",
    share_btn: "Download Instagram card",
    ig_cover: "of the lake covered by weed",
    ig_change: (p, d) => `${p} points since ${d}`,
    ig_water: (w, a) => `${w} ha open water left of ${a} ha`,
    ig_note: "Satellite estimate · Sentinel-2 · 10 m pixels",
    no_data: "No clear satellite images processed yet.",
    how_title: "How this works",
    how_body: `
<h3>What the satellite sees</h3>
<p>The European Space Agency's <b>Sentinel-2</b> satellites photograph every part of the Earth roughly every 5 days. Besides normal colours they measure light our eyes can't see, especially <b>near-infrared</b>. Living leaves reflect a lot of near-infrared light; water absorbs almost all of it. So weed floating on the lake "glows" in near-infrared while open water stays dark.</p>
<h3>How a pixel is labelled "weed"</h3>
<p>The picture is made of squares called <b>pixels</b>, each <b>10 m × 10 m</b> on the ground (about the size of a small house plot). The lake (about 9.5 hectares) contains roughly 900 of them. For every pixel inside the fixed lake outline we calculate two scores:</p>
<ul>
<li><b>Greenness (NDVI)</b>: high for leaves, low for water.</li>
<li><b>Wetness (water index, NDWI)</b>: high for open water, low when leaves cover it.</li>
</ul>
<p>A pixel is counted as weed when it is green <i>and</i> no longer looks like open water. Weed cover is the share of visible lake pixels labelled weed. Because the outline never changes, a lake fully choked with weed still counts as lake: it does not "disappear" from the numbers.</p>
<h3>Clouds and the monsoon</h3>
<p>Satellites can't see through clouds. Each image comes with a cloud map; we ignore cloud, cloud shadow and haze pixels, and skip the whole image if less than 70% of the lake is clearly visible. During the monsoon (June–September) there are often weeks with no clear image. The chart shows these as <b>gaps</b>: we never invent numbers for them.</p>
<h3>Why these are estimates</h3>
<ul>
<li>10 m pixels can't see small patches of weed or thin strips along the bank. Pixels touching the shore are left out because trees and walls would be mistaken for weed.</li>
<li>Thin or scattered weed, algae, or very muddy water can be misread. The shaded band on the chart shows how much the answer changes if the rule is made a little stricter or looser.</li>
<li>Some clear images still give unreliable numbers: when the lake is partly dry (in 2020 and 2021 the lake bed was exposed for months), or when thin haze remains. These are marked <b>low confidence</b>, drawn as hollow grey dots, and never used for the headline numbers.</li>
<li>The thresholds are being checked against photos taken at the lake, and may be adjusted. When they change, the whole history is recalculated the same way, so dates stay comparable.</li>
</ul>
<h3>Open and free</h3>
<p>Everything runs automatically and for free: the images come from Microsoft Planetary Computer, the calculations run on GitHub Actions, and all the code and data are public. Anyone can check the method or reuse it for their own lake.</p>`,
    footer: `Satellite estimates for public awareness by <a href="https://instagram.com/savevadalelake">@savevadalelake</a>. Contains modified Copernicus Sentinel data, processed via Microsoft Planetary Computer. Lake outline © OpenStreetMap contributors (ODbL). Map imagery © Esri, Maxar, Earthstar Geographics. <a href="https://github.com/naman1911/Vadale-Watch">Code and data</a>.`,
  },
  mr: {
    title: "वडाळे तलाव निरीक्षण",
    subtitle: "जुने पनवेल येथील वडाळे तलावावरील जलपर्णी/तणाचा अवकाशातून मागोवा",
    badge: "उपग्रह अंदाज",
    banner: "या पानावरील सर्व आकडे १० मीटरच्या उपग्रह पिक्सेलवरून काढलेले अंदाज आहेत, प्रत्यक्ष मोजमाप नाही.",
    key_weed: "तण",
    key_water: "मोकळे पाणी",
    key_mud: "चिखल / उघडा तळ",
    key_hidden: "ढगांमुळे झाकलेले",
    right_now: "सध्या",
    on_date: (d) => `${d} रोजी`,
    latest_image: (d) => `ताजी उपग्रह प्रतिमा: ${d}`,
    p_what: "तलाव तणाने झाकलेला आहे",
    to_latest: "ताज्या माहितीकडे",
    swipe_hint: "आधीच्या तारखा पाहण्यासाठी सरकवा",
    gap_short: "स्वच्छ प्रतिमा नाहीत",
    p_note: "नकाशावरील प्रत्येक चौकोन म्हणजे १० मीटरचा एक उपग्रह पिक्सेल.",
    layer_btn_weed: "तण",
    layer_btn_photo: "फोटो",
    scroll_cue: "संपूर्ण माहितीसाठी खाली स्क्रोल करा",
    visible_short: (v) => `तलावाचा ${v}% भाग दिसला`,
    stat_cover: "सध्या तणाचे आच्छादन",
    stat_change: "सप्टेंबर २०२५ पासूनचा बदल",
    stat_water: "उरलेले मोकळे पाणी",
    range: (lo, hi) => `बहुधा ${lo}% ते ${hi}% दरम्यान`,
    range_short: (lo, hi) => `बहुधा ${lo}–${hi}%`,
    image_of: (d) => `${d} ची उपग्रह प्रतिमा`,
    visible_note: (v) => `तलावाचा ${v}% भाग दिसला; उरलेला ढग किंवा धुक्यामुळे दिसला नाही`,
    change_pts: "टक्के गुण",
    change_detail: (a, d0, b) => `${d0} रोजी ${a}% वरून आता ${b}%`,
    change_none: "अजून पुरेशा स्वच्छ प्रतिमा नाहीत",
    water_of: (a) => `तलावाच्या एकूण ${a} हेक्टरपैकी`,
    checked: (d, n) => `शेवटची उपग्रह तपासणी: ${d}. ${n} प्रतिमा तपासल्या; ढगाळ प्रतिमा वगळल्या.`,
    next_passes: (d) => `पुढील उपग्रह फेऱ्या (सुमारे सकाळी ११ वाजता, ढग नसल्यास): ${d}.`,
    takeaway: (a, ma, b, mb, up) => `${ma} मध्ये <b>${a}%</b> असलेले तण ${mb} मध्ये <b class="${up ? "up" : "down"}">${b}%</b> ${up ? "▲" : "▼"}`,
    takeaway_worst: (m, v, y) => `हा ${m} (<b class="up">${v}%</b>) ${y} पासूनचा सर्वात वाईट ${m} आहे.`,
    takeaway_best: (m, v, y) => `हा ${m} (<b class="down">${v}%</b>) ${y} पासूनचा सर्वात चांगला ${m} आहे.`,
    takeaway_range: (my, v, m, lo, hi) => `${my}: <b>${v}%</b> तण. आधीच्या वर्षांत ${m} मध्ये ${lo}% ते ${hi}% होते.`,
    detail: (m, v, n, lo, hi) => `${m}: सुमारे ${v}% तण, ${n} स्वच्छ प्रतिमांचे सामान्य मूल्य (${lo}–${hi}% दरम्यान).`,
    detail_none: (m) => `${m}: स्वच्छ उपग्रह प्रतिमा नाहीत (बहुधा पावसाळी ढग).`,
    detail_flag: (m) => `${m}: फक्त कमी विश्वासार्ह प्रतिमा (तलाव अंशतः कोरडा किंवा धुके), म्हणून आकडा दाखवला नाही.`,
    months_short: ["जा", "फे", "मा", "ए", "मे", "जू", "जु", "ऑग", "स", "ऑक्", "नो", "डि"],
    chart_title: "काळानुसार तणाचे आच्छादन",
    range_campaign: "सप्टें. २०२५ पासून",
    range_years: "वर्षानुसार",
    chart_note: "प्रत्येक खांब म्हणजे एक महिना: हिरवा = तलावाचा किती भाग तणाने झाकलेला होता (त्या महिन्यातील स्वच्छ उपग्रह प्रतिमांचे सामान्य मूल्य), निळा = मोकळे पाणी. ☁ = त्या महिन्यात स्वच्छ प्रतिमा नाहीत, बहुधा पावसाळी ढग. माहितीसाठी खांबावर टॅप करा.",
    chart_note_years: "प्रत्येक चौकोन म्हणजे एक महिना; गडद हिरवा = जास्त तण. ☁ = स्वच्छ प्रतिमा नाहीत (पावसाळी ढग). ? = फक्त कमी विश्वासार्ह प्रतिमा (तलाव अंशतः कोरडा किंवा धुके). माहितीसाठी चौकोनावर टॅप करा.",
    table_toggle: "सर्व आकडे तक्त्यात पाहा",
    th_date: "तारीख", th_weed: "तण %", th_range: "श्रेणी", th_water: "मोकळे पाणी (हे.)", th_visible: "दिसणारा तलाव",
    th_note: "टीप",
    flag_lake_bed_exposed: "तलाव अंशतः कोरडा (तळ उघडा), तणाचा % अर्थपूर्ण नाही",
    flag_wide_range: "अविश्वसनीय (धुके किंवा खूप विरळ तण)",
    csv: "माहिती डाउनलोड करा (CSV)",
    compare_title: "आधी / नंतर",
    compare_before: "आधी",
    compare_after: "नंतर",
    compare_note: "स्लायडर ओढा. प्रत्येक चौकोन म्हणजे १० मी × १० मी चा एक उपग्रह पिक्सेल.",
    share_title: "ताजे आकडे शेअर करा",
    share_text: "आजच्या उपग्रह अंदाजासह इन्स्टाग्रामसाठी तयार १०८०×१०८० प्रतिमा डाउनलोड करा.",
    share_btn: "इन्स्टाग्राम कार्ड डाउनलोड करा",
    ig_cover: "तलाव तणाने झाकलेला",
    ig_change: (p, d) => `${d} पासून ${p} गुण`,
    ig_water: (w, a) => `${a} हेक्टरपैकी ${w} हेक्टर मोकळे पाणी`,
    ig_note: "उपग्रह अंदाज · सेंटिनेल-२ · १० मी पिक्सेल",
    no_data: "अजून कोणतीही स्वच्छ उपग्रह प्रतिमा प्रक्रिया केलेली नाही.",
    how_title: "हे कसे काम करते",
    how_body: `
<h3>उपग्रहाला काय दिसते</h3>
<p>युरोपियन स्पेस एजन्सीचे <b>सेंटिनेल-२</b> उपग्रह पृथ्वीच्या प्रत्येक भागाचा साधारण दर ५ दिवसांनी फोटो घेतात. सामान्य रंगांबरोबरच ते आपल्या डोळ्यांना न दिसणारा प्रकाशही मोजतात, विशेषतः <b>निकट-अवरक्त (near-infrared)</b>. जिवंत पाने हा प्रकाश जास्त परावर्तित करतात, तर पाणी तो जवळजवळ पूर्ण शोषून घेते. म्हणून तलावावर तरंगणारे तण या प्रकाशात "उजळ" दिसते आणि मोकळे पाणी गडद राहते.</p>
<h3>एखादा पिक्सेल "तण" कसा ठरतो</h3>
<p>प्रतिमा <b>पिक्सेल</b> नावाच्या चौकोनांनी बनलेली असते; प्रत्येक पिक्सेल जमिनीवर <b>१० मी × १० मी</b> इतका असतो. तलावात (सुमारे ९.५ हेक्टर) असे सुमारे ९०० पिक्सेल आहेत. निश्चित तलाव-सीमेतील प्रत्येक पिक्सेलसाठी आम्ही दोन गुण काढतो:</p>
<ul>
<li><b>हिरवेपणा (NDVI)</b>: पानांसाठी जास्त, पाण्यासाठी कमी.</li>
<li><b>ओलेपणा (जल निर्देशांक, NDWI)</b>: मोकळ्या पाण्यासाठी जास्त, पाने झाकल्यावर कमी.</li>
</ul>
<p>जो पिक्सेल हिरवा आहे <i>आणि</i> मोकळ्या पाण्यासारखा दिसत नाही, तो तण म्हणून मोजला जातो. दिसणाऱ्या तलाव-पिक्सेलपैकी तण असलेल्यांचा वाटा म्हणजे तणाचे आच्छादन. सीमा कधीच बदलत नसल्याने, पूर्ण तणाने भरलेला तलावही तलाव म्हणूनच मोजला जातो.</p>
<h3>ढग आणि पावसाळा</h3>
<p>उपग्रह ढगांच्या आरपार पाहू शकत नाही. प्रत्येक प्रतिमेसोबत ढगांचा नकाशा येतो; आम्ही ढग, ढगांची सावली आणि धुके असलेले पिक्सेल वगळतो, आणि तलावाचा ७०% पेक्षा कमी भाग स्पष्ट दिसत असल्यास ती प्रतिमाच वगळतो. पावसाळ्यात (जून–सप्टेंबर) अनेक आठवडे स्वच्छ प्रतिमा मिळत नाहीत. आलेखात हे <b>खंड</b> म्हणून दाखवले आहेत: आम्ही ते आकडे कधीच तयार करत नाही.</p>
<h3>हे अंदाज का आहेत</h3>
<ul>
<li>१० मीटरच्या पिक्सेलमध्ये तणाचे छोटे तुकडे किंवा काठावरील अरुंद पट्टे दिसत नाहीत. काठाला लागून असलेले पिक्सेल वगळले जातात, कारण झाडे व भिंती तण समजल्या जाऊ शकतात.</li>
<li>विरळ तण, शेवाळ किंवा खूप गढूळ पाणी चुकीचे ओळखले जाऊ शकते. नियम थोडा कडक किंवा सैल केल्यास उत्तर किती बदलते हे आलेखावरील छायांकित पट्टा दाखवतो.</li>
<li>काही स्वच्छ प्रतिमांमधूनही अविश्वसनीय आकडे येतात: तलाव अंशतः कोरडा असताना (२०२० व २०२१ मध्ये तलावाचा तळ महिनोन्‌महिने उघडा होता), किंवा हलके धुके असताना. अशा तारखा <b>कमी विश्वासार्ह</b> म्हणून पोकळ राखाडी ठिपक्यांनी दाखवल्या जातात आणि मुख्य आकड्यांसाठी वापरल्या जात नाहीत.</li>
<li>हे नियम तलावावर घेतलेल्या फोटोंशी तपासले जात आहेत आणि बदलू शकतात. बदल झाल्यास संपूर्ण इतिहास त्याच पद्धतीने पुन्हा मोजला जातो, त्यामुळे तारखांची तुलना योग्य राहते.</li>
</ul>
<h3>खुले आणि मोफत</h3>
<p>सर्व काही आपोआप आणि मोफत चालते: प्रतिमा Microsoft Planetary Computer वरून येतात, गणना GitHub Actions वर होते, आणि सर्व कोड व माहिती सार्वजनिक आहे. कोणीही पद्धत तपासू शकतो किंवा आपल्या तलावासाठी वापरू शकतो.</p>`,
    footer: `जनजागृतीसाठी उपग्रह अंदाज: <a href="https://instagram.com/savevadalelake">@savevadalelake</a>. सुधारित Copernicus Sentinel माहिती, Microsoft Planetary Computer द्वारे प्रक्रिया. तलाव सीमा © OpenStreetMap योगदानकर्ते (ODbL). नकाशा प्रतिमा © Esri, Maxar, Earthstar Geographics. <a href="https://github.com/naman1911/Vadale-Watch">कोड आणि माहिती</a>.`,
  },
};
