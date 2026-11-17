# Zdrowie Taty

Strona na telefon: codzienne pomiary cukru i ciśnienia, wykaz leków, magazyn tabletek i alarm o zamówieniu.
Jeden plik `index.html` + Firebase (Firestore i logowanie) + GitHub Pages, jak w Butli.

## Dane w Firestore

| Kolekcja | Pola |
|---|---|
| `cukier` | `wartosc`, `kiedy` |
| `cisnienie` | `gorne`, `dolne`, `puls`, `kiedy` |
| `leki` | `nazwa`, `dawki` (5 pór: przed śniadaniem, po śniadaniu, po obiedzie, po kolacji, na noc), `naDzien` (suma dawek), `stan`, `stanData` |
| `ustawienia/alarm` | `prog` (dni), `sprawdzono` i `wyslano` (zapisuje skrypt maila) |

Dostęp ma tylko konto `guldorf@tata.app` (`firestore.rules`). Hasła nie ma w kodzie: pierwsze logowanie na stronie zakłada konto.

## Jak liczone są leki

`stan` to liczba tabletek w dniu `stanData`, rano, przed dzisiejszą dawką. Każdy kolejny dzień odejmuje `naDzien`.
Zmiana dawki najpierw przelicza stan po starej dawce, a nowa obowiązuje od dziś.
Alarm włącza się, gdy leku zostaje na `prog` dni lub mniej.

## Mail

`alarm-mail.gs` działa w Google Apps Script na koncie właściciela, codziennie około 8:00, i wysyła maila na to konto.
Pierwszy mail idzie po przekroczeniu progu (domyślnie 10 dni), potem co 3 dni, dopóki stan leku nie zostanie uzupełniony.
Mail wymienia leki do zamówienia i te, które skończą się niedługo (do 2 x próg), oraz pokazuje słupki z zapasem wszystkich leków.
Funkcja `wyslijProbny` wysyła taki mail od razu, żeby zobaczyć, jak wygląda.
Strona pokazuje w Magazynie, kiedy skrypt ostatnio sprawdzał leki.
Mail idzie na konto właściciela skryptu i na drugi adres wpisany w Magazynie.

### Podsumowanie miesiąca

`raportMiesieczny` uruchamia się codziennie około 21:00 (`godzinaRaportu`), ale mail wysyła tylko w ostatni dzień miesiąca, za cały ten miesiąc.
Cukier: średnia, najniższy i najwyższy odczyt, liczba pomiarów, wykres liniowy wszystkich odczytów z granicami 70 i 180 mg/dL (`cukierNisko`, `cukierWysoko`), porównanie średniej z poprzednim miesiącem.
Wykres to obrazek z usługi Charts w Apps Script; gdyby się nie wygenerował, mail pokazuje słupki średnich dziennych zrobione z tabeli HTML.
Leki: ten sam wykres co w Magazynie na stronie („Na ile dni starczą leki": kolory leków, linia progu, skala do 60 dni), stan na 1. dzień następnego miesiąca, a pod nim ile tabletek poszło w miesiącu według dawkowania i ile zostało.
Kolory liczy `koloryLekow_` tak samo jak `koloryLekow` w `index.html`; po zmianie jednego trzeba zmienić drugi.
`wyslijRaportProbny` wysyła podsumowanie bieżącego miesiąca do dziś, tylko na adres właściciela.
`zainstalujRaport` włącza sam wyzwalacz podsumowania, bez ruszania codziennego sprawdzania leków (`zainstaluj` włącza oba).

Instalacja: nowy projekt na script.google.com, wklej plik, wpisz `HASLO`, wybierz funkcję `zainstaluj`, Uruchom, zezwól na dostęp.
Hasło wpisuje się tylko w kopii na script.google.com, nigdy w tym repozytorium.
