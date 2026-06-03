RETINA AI - Smart Coach

Kurulum:
1) Klasörü bir HTTPS sunucuda veya localhost üzerinde açın. Kamera API için file:// yerine localhost/HTTPS önerilir.
2) index.html canlı analiz ekranıdır.
3) Dashboard, Geçmiş, Egzersizler ve Rapor sayfaları localStorage kayıtlarını kullanır.

Eklenenler:
- Tek CSS: css/style.css
- Tek ana JS: js/app.js
- Yardımcı sayfa JS: js/pages.js
- Kalıcı ayarlar ve kalibrasyon kaydı
- Form skoru, analiz güveni, tekrar/set göstergesi
- Gerçek PDF raporu
- Seans geçmişi ve dashboard
- Egzersiz kütüphanesi
- PWA manifest + service worker

Not: Bu uygulama tıbbi tanı aracı değildir; kamera temelli form geri bildirimi sağlar.


Güncelleme:
- Hata tipi değiştiğinde sesli uyarının bastırılması düzeltildi.
- Aynı form bozukluğu sürerken omuz/omurga/kalça gibi farklı uyarılar artık sesli okunur.

Güncelleme:
- Çoklu postür hatalarında sesli uyarılar tek mesaja kilitlenmez; uyarı adayları arasında sırayla döner.


Alert-Based Voice Fix:
- Sesli uyarı artık ekrandaki alt uyarı metnini doğrudan okur.
- Baş-boyun için sabit koç tavsiyesine dönüşme problemi giderildi.
- Omuz, omurga, kalça, diz ve egzersiz uyarıları ekranda nasıl görünüyorsa ses de o metni temel alır.


No-Coach Repeat Fix:
- Canlı kamera üzerindeki Akıllı Koç balonu kaldırıldı.
- Aynı uyarı aynı bozuk form sürecinde tekrar tekrar sesli okunmaz.
- Uyarı tipi değişirse veya form düzelip tekrar bozulursa ses yeniden çalışır.
- PWA cache adı güncellendi; eski kayıt takılırsa tarayıcı önbelleğini temizleyin.


--- Calm Voice Fix ---
- Normal postür/egzersiz uyarıları artık konuşan sesi yarıda kesmez.
- Ses devam ederken yeni uyarı gelirse sadece en son geçerli uyarı bekletilir.
- Aynı hata aynı bozuk form sürecinde tekrar tekrar okunmaz.
- Form düzeldiğinde bekleyen uyarılar iptal edilir ve aynı hata tekrar yapılırsa yeniden okunabilir.
- Geri sayım, kalibrasyon gibi sistem sesleri gerektiğinde kesebilir; normal form uyarıları kesemez.

