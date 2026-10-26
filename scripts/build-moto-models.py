#!/usr/bin/env python3
"""Writes data/moto-models.json: every common motorcycle model line sold in Canada and the US, by make, with the
model years it was sold and about the maker's numbers (kg ready to ride, tank litres, litres per 100 km).

Hand-made (alex 2026-10-26: "put every model of every mark"): the free US list (NHTSA vPIC) had other makes' names and
engine codes in it, so the app reads this list instead. Numbers are about right for the model line, and the rider
changes them for their own bike. Run: python3 scripts/build-moto-models.py
"""
import json, os

NOW = 0  # still made
# Off-road and competition bikes: (kg, tank, L/100 km), all the app's "enduro" kind (light dirt bikes).
DIRT = {
    "pw": (39, 2, 2.0), "mini50": (41, 2.3, 3.0), "mini65": (55, 3.5, 4.0), "mini85": (72, 5.3, 5.0), "mini112": (78, 5.3, 5.0),
    "kid110": (75, 3.8, 2.5), "kid125": (88, 6, 3.0), "kid150": (105, 7.5, 3.2), "trail230": (115, 8, 3.2),
    "mx125": (94, 7, 6.0), "mx150": (95, 7, 6.0), "mx250t": (100, 7, 7.0), "mx250": (104, 6.5, 5.5), "mx350": (106, 7, 6.0),
    "mx450": (110, 6.5, 6.5), "mx500t": (108, 8, 8.0), "mx500": (112, 7, 7.0),
    "en125": (100, 8.5, 5.0), "en250t": (106, 9, 6.0), "en300t": (107, 9, 6.0),
    "en250": (110, 8.5, 4.4), "en350": (112, 8.5, 4.5), "en450": (116, 8.5, 5.0), "en500": (118, 9, 5.0), "en600": (125, 10, 5.2),
    "trial": (72, 3, 3.0),
}
M = {}


def make(name, *rows):
    out = M.setdefault(name, [])
    for r in rows:
        if len(r) == 4:  # (model, from, to, dirt class)
            n, a, b, k = r
            kg, tank, l100 = DIRT[k]
            out.append([n, a, b, "enduro", kg, tank, l100])
        else:            # (model, from, to, kind, kg, tank, L/100)
            out.append(list(r))


def dirt(prefix, rows):
    return [(f"{prefix}{n}", a, b, k) for n, a, b, k in rows]


make("KTM",
     *dirt("", [("50 SX", 1999, NOW, "mini50"), ("50 SX Mini", 2004, NOW, "pw"), ("65 SX", 1998, NOW, "mini65"), ("85 SX", 2003, NOW, "mini85"),
                ("105 SX", 2004, 2011, "mini112"), ("125 SX", 1990, NOW, "mx125"), ("144 SX", 2007, 2008, "mx150"), ("150 SX", 2009, 2015, "mx150"),
                ("250 SX", 1990, NOW, "mx250t"), ("250 SX-F", 2005, NOW, "mx250"), ("350 SX-F", 2011, NOW, "mx350"), ("450 SX", 2003, 2006, "mx450"),
                ("450 SX-F", 2007, NOW, "mx450"), ("505 SX-F", 2008, 2009, "mx500"), ("520 SX", 2000, 2002, "mx500"), ("525 SX", 2003, 2006, "mx500"),
                ("125 XC", 2017, 2023, "en125"), ("150 XC", 2010, 2014, "en125"), ("150 XC-W", 2017, 2023, "en125"), ("200 XC", 2006, 2009, "en250t"),
                ("200 XC-W", 2006, 2016, "en250t"), ("250 XC", 2008, NOW, "en250t"), ("250 XC-W", 2005, NOW, "en250t"), ("300 XC", 2008, NOW, "en300t"),
                ("300 XC-W", 2005, NOW, "en300t"), ("250 XC-F", 2008, NOW, "en250"), ("250 XCF-W", 2007, 2016, "en250"), ("350 XC-F", 2011, NOW, "en350"),
                ("350 XCF-W", 2015, 2016, "en350"), ("450 XC-F", 2008, NOW, "en450"), ("450 XC-W", 2007, 2016, "en450"), ("500 XC-W", 2012, 2023, "en500"),
                ("250 XW-F", 2024, NOW, "en250"), ("350 XW-F", 2024, NOW, "en350"), ("500 XW-F", 2024, NOW, "en500"), ("300 XC-W Hardenduro", 2024, NOW, "en300t"),
                ("200 EXC", 1998, 2016, "en250t"), ("250 EXC", 1990, 2005, "en250t"), ("300 EXC", 1990, 2005, "en300t"), ("250 EXC-F", 2004, 2016, "en250"),
                ("350 EXC-F", 2014, NOW, "en350"), ("400 EXC", 2001, 2011, "en450"), ("450 EXC", 2003, 2011, "en450"), ("450 EXC-F", 2017, 2018, "en450"),
                ("500 EXC", 2012, 2016, "en500"), ("500 EXC-F", 2017, NOW, "en500"), ("520 EXC", 2000, 2002, "en500"), ("525 EXC", 2003, 2007, "en500"),
                ("530 EXC", 2008, 2011, "en500"), ("625 SXC", 2003, 2007, "en600")]),
     ("640 LC4 Enduro", 1999, 2007, "light", 152, 12, 5.0), ("640 Adventure", 1998, 2007, "light", 175, 28, 5.2),
     ("690 Enduro", 2008, 2008, "light", 155, 12, 4.4), ("690 Enduro R", 2009, NOW, "light", 160, 13.5, 4.2), ("690 SMC R", 2012, NOW, "street", 158, 13.5, 4.4),
     ("690 Duke", 2012, 2019, "street", 162, 14, 4.3), ("950 Adventure", 2003, 2006, "big", 230, 22, 6.5), ("950 Super Enduro R", 2006, 2008, "big", 205, 13.5, 6.5),
     ("950 Supermoto", 2006, 2008, "street", 205, 16, 6.3), ("990 Adventure", 2006, 2013, "big", 233, 19.5, 6.5), ("990 Adventure R", 2009, 2013, "big", 228, 19.5, 6.5),
     ("990 Adventure Baja", 2013, 2013, "big", 233, 19.5, 6.5), ("990 Super Duke", 2005, 2013, "street", 199, 18.5, 6.5), ("990 SMT", 2009, 2013, "street", 213, 19, 6.3),
     ("1050 Adventure", 2015, 2016, "big", 226, 23, 5.5), ("1090 Adventure R", 2017, 2019, "big", 230, 23, 5.6), ("1190 Adventure", 2013, 2016, "big", 230, 23, 5.6),
     ("1190 Adventure R", 2013, 2016, "big", 230, 23, 5.6), ("1190 RC8", 2008, 2010, "street", 200, 16.5, 6.5), ("1190 RC8 R", 2009, 2015, "street", 200, 16.5, 6.5),
     ("1290 Super Adventure T", 2015, 2016, "big", 249, 30, 5.9), ("1290 Super Adventure S", 2017, 2024, "big", 243, 23, 5.9), ("1290 Super Adventure R", 2017, 2024, "big", 240, 23, 6.0),
     ("1290 Super Duke R", 2014, NOW, "street", 205, 17.5, 6.5), ("1290 Super Duke GT", 2017, 2023, "street", 229, 23, 6.2),
     ("1390 Super Duke R", 2024, NOW, "street", 210, 17.5, 6.6), ("1390 Super Adventure S Evo", 2025, NOW, "big", 248, 23, 6.0), ("1390 Super Adventure R", 2025, NOW, "big", 240, 23, 6.0),
     ("790 Duke", 2019, NOW, "street", 187, 14, 4.4), ("790 Adventure", 2019, NOW, "mid", 209, 20, 4.5), ("790 Adventure R", 2019, 2020, "mid", 210, 20, 4.5),
     ("890 Duke", 2021, NOW, "street", 185, 14, 4.6), ("890 Duke R", 2020, 2023, "street", 182, 14, 4.6), ("890 Adventure", 2021, NOW, "mid", 211, 20, 4.6),
     ("890 Adventure R", 2021, NOW, "mid", 210, 20, 4.6), ("890 SMT", 2023, NOW, "street", 194, 15.8, 4.6), ("990 Duke", 2024, NOW, "street", 190, 14.5, 4.8),
     ("200 Duke", 2014, 2015, "street", 139, 10.5, 3.0), ("390 Duke", 2015, NOW, "street", 165, 15, 3.4), ("RC 390", 2015, NOW, "street", 172, 13.7, 3.4),
     ("390 Adventure", 2020, 2024, "light", 172, 14.5, 3.4), ("390 Adventure X", 2025, NOW, "light", 182, 14.5, 3.5), ("390 Adventure R", 2025, NOW, "light", 182, 14.5, 3.5),
     ("390 Enduro R", 2025, NOW, "light", 159, 9, 3.4), ("390 SMC R", 2025, NOW, "street", 154, 9, 3.4))

make("Husqvarna",
     *dirt("", [("TC 50", 2017, NOW, "mini50"), ("TC 65", 2017, NOW, "mini65"), ("TC 85", 2014, NOW, "mini85"), ("TC 125", 2014, NOW, "mx125"),
                ("TC 250", 2014, NOW, "mx250t"), ("FC 250", 2014, NOW, "mx250"), ("FC 350", 2014, NOW, "mx350"), ("FC 450", 2014, NOW, "mx450"),
                ("TX 125", 2018, 2023, "en125"), ("TX 300", 2017, 2023, "en300t"), ("FX 350", 2017, NOW, "en350"), ("FX 450", 2017, NOW, "en450"),
                ("TE 150", 2017, 2023, "en125"), ("TE 250", 2014, NOW, "en250t"), ("TE 300", 2014, NOW, "en300t"), ("FE 250", 2014, NOW, "en250"),
                ("FE 350", 2014, NOW, "en350"), ("FE 350s", 2018, NOW, "en350"), ("FE 450", 2014, NOW, "en450"), ("FE 501", 2014, NOW, "en500"),
                ("FE 501s", 2018, NOW, "en500"), ("CR 125", 1990, 2013, "mx125"), ("WR 125", 1990, 2013, "en125"), ("WR 250", 1990, 2013, "en250t"),
                ("WR 300", 2009, 2013, "en300t"), ("TC 449", 2011, 2013, "mx450"), ("TE 250 (Italy)", 2002, 2013, "en250"), ("TE 310", 2009, 2013, "en350"),
                ("TE 449", 2011, 2013, "en450"), ("TE 450", 2002, 2010, "en450"), ("TE 510", 2004, 2010, "en500"), ("TE 511", 2011, 2013, "en500"),
                ("TXC 250", 2008, 2013, "en250"), ("TXC 310", 2009, 2013, "en350"), ("TXC 449", 2011, 2013, "en450"), ("TXC 511", 2011, 2013, "en500"),
                ("TC 250 (Italy)", 2002, 2013, "mx250"), ("TC 450", 2002, 2010, "mx450")]),
     ("TE 610", 1998, 2010, "light", 145, 12, 5.0), ("TE 630", 2010, 2012, "light", 145, 12, 5.0), ("SM 610", 1998, 2010, "street", 145, 12, 5.0),
     ("SMS 630", 2010, 2012, "street", 145, 12, 5.0), ("SMR 449", 2011, 2013, "street", 120, 8, 5.0), ("SMR 511", 2011, 2013, "street", 122, 8, 5.0),
     ("TR650 Terra", 2013, 2014, "light", 175, 14, 4.5), ("TR650 Strada", 2013, 2014, "street", 175, 14, 4.5), ("Nuda 900", 2012, 2013, "street", 196, 13, 5.7),
     ("701 Enduro", 2016, NOW, "light", 160, 13, 4.2), ("701 Enduro LR", 2020, NOW, "light", 166, 25, 4.3), ("701 Supermoto", 2016, NOW, "street", 158, 13, 4.3),
     ("Norden 901", 2022, NOW, "mid", 204, 19, 4.5), ("Norden 901 Expedition", 2023, NOW, "mid", 209, 19, 4.5),
     ("Vitpilen 401", 2018, NOW, "street", 158, 9.5, 3.4), ("Svartpilen 401", 2018, NOW, "street", 160, 9.5, 3.4), ("Vitpilen 701", 2018, 2022, "street", 166, 12, 4.3),
     ("Svartpilen 701", 2019, 2022, "street", 168, 12, 4.3), ("Svartpilen 801", 2024, NOW, "street", 190, 14, 4.8), ("Vitpilen 801", 2025, NOW, "street", 188, 14, 4.8))

make("GasGas",
     *dirt("", [("MC 50", 2021, NOW, "mini50"), ("MC 65", 2021, NOW, "mini65"), ("MC 85", 2021, NOW, "mini85"), ("MC 125", 2021, NOW, "mx125"),
                ("MC 250", 2021, NOW, "mx250t"), ("MC 250F", 2021, NOW, "mx250"), ("MC 350F", 2022, NOW, "mx350"), ("MC 450F", 2021, NOW, "mx450"),
                ("EX 250", 2022, NOW, "en250t"), ("EX 300", 2021, NOW, "en300t"), ("EX 250F", 2021, NOW, "en250"), ("EX 350F", 2021, NOW, "en350"),
                ("EX 450F", 2021, NOW, "en450"), ("EC 250", 2000, 2023, "en250t"), ("EC 300", 2000, 2023, "en300t"), ("EC 200", 2000, 2018, "en250t"),
                ("EC 250F", 2010, 2015, "en250"), ("EC 300F", 2012, 2015, "en350"), ("EC 350F", 2021, NOW, "en350"), ("XC 300", 2013, 2017, "en300t"),
                ("TXT Pro 280", 2002, 2020, "trial"), ("TXT Racing 300", 2017, NOW, "trial")]),
     ("ES 700", 2022, NOW, "light", 158, 13.5, 4.2), ("SM 700", 2022, NOW, "street", 155, 13.5, 4.3))

make("Beta",
     *dirt("", [("125 RR", 2018, NOW, "en125"), ("200 RR", 2019, NOW, "en250t"), ("250 RR", 2013, NOW, "en250t"), ("300 RR", 2013, NOW, "en300t"),
                ("250 Xtrainer", 2016, NOW, "en250t"), ("300 Xtrainer", 2015, NOW, "en300t"), ("350 RR", 2011, NOW, "en350"), ("390 RR", 2015, NOW, "en350"),
                ("400 RR", 2010, 2014, "en450"), ("430 RR", 2015, NOW, "en450"), ("450 RR", 2010, 2014, "en450"), ("480 RR", 2015, NOW, "en500"),
                ("498 RR", 2012, 2014, "en500"), ("520 RR", 2010, 2011, "en500"), ("350 RR-S", 2011, NOW, "en350"), ("390 RR-S", 2015, NOW, "en350"),
                ("430 RR-S", 2015, NOW, "en450"), ("500 RR-S", 2013, NOW, "en500"), ("125 RR-S", 2024, NOW, "en125"), ("RX 300", 2023, NOW, "mx250t"),
                ("RX 450", 2022, NOW, "mx450"), ("Evo 300", 2009, NOW, "trial"), ("Evo 250", 2009, NOW, "trial")]),
     ("Alp 4.0", 2005, 2020, "light", 125, 9.5, 3.5))

make("Sherco",
     *dirt("", [("125 SE", 2018, NOW, "en125"), ("250 SE", 2014, NOW, "en250t"), ("300 SE", 2014, NOW, "en300t"), ("250 SEF", 2014, NOW, "en250"),
                ("300 SEF", 2014, NOW, "en350"), ("450 SEF", 2012, NOW, "en450"), ("500 SEF", 2016, NOW, "en500"), ("250 SE Factory", 2015, NOW, "en250t"),
                ("300 SE Factory", 2015, NOW, "en300t"), ("300 SEF Factory", 2015, NOW, "en350"), ("450 SEF Factory", 2015, NOW, "en450"),
                ("500 SEF Factory", 2016, NOW, "en500"), ("ST 300 Trial", 2008, NOW, "trial")]))

make("BMW",
     ("R 80 G/S", 1981, 1987, "big", 198, 19.5, 5.5), ("R 80 GS", 1988, 1996, "big", 210, 26, 5.5), ("R 100 GS", 1988, 1996, "big", 210, 24, 5.8),
     ("R 100 GS Paris-Dakar", 1989, 1996, "big", 236, 35, 5.8), ("R 1100 GS", 1994, 1999, "big", 243, 25, 5.8), ("R 1150 GS", 2000, 2004, "big", 249, 22, 5.7),
     ("R 1150 GS Adventure", 2002, 2005, "big", 253, 30, 5.9), ("R 1200 GS", 2004, 2018, "big", 244, 20, 5.3), ("R 1200 GS Adventure", 2006, 2018, "big", 263, 30, 5.5),
     ("R 1250 GS", 2019, 2024, "big", 249, 20, 4.9), ("R 1250 GS Adventure", 2019, 2024, "big", 268, 30, 5.1), ("R 1300 GS", 2024, NOW, "big", 237, 19, 4.8),
     ("R 1300 GS Adventure", 2025, NOW, "big", 269, 30, 5.0), ("HP2 Enduro", 2005, 2008, "big", 196, 13, 5.8),
     ("F 650", 1994, 2000, "light", 191, 17.5, 4.3), ("F 650 GS", 2000, 2007, "light", 193, 17.3, 4.0), ("F 650 GS Dakar", 2000, 2007, "light", 192, 17.3, 4.0),
     ("F 650 GS (800 twin)", 2008, 2012, "mid", 199, 16, 4.2), ("G 650 GS", 2009, 2016, "light", 192, 14, 3.8), ("G 650 GS Sertão", 2012, 2016, "light", 193, 14, 3.8),
     ("G 650 X-Challenge", 2007, 2009, "light", 156, 9.5, 4.0), ("G 650 X-Country", 2007, 2009, "light", 156, 9.5, 4.0), ("G 450 X", 2008, 2010, "enduro", 128, 8.5, 4.5),
     ("F 700 GS", 2013, 2018, "mid", 209, 16, 4.0), ("F 800 GS", 2008, 2018, "mid", 214, 16, 4.3), ("F 800 GS Adventure", 2014, 2018, "big", 229, 24, 4.5),
     ("F 800 GS (2024)", 2024, NOW, "mid", 227, 15, 4.3), ("F 750 GS", 2019, 2023, "mid", 224, 15, 4.2), ("F 850 GS", 2019, 2023, "big", 229, 15, 4.6),
     ("F 850 GS Adventure", 2019, 2023, "big", 244, 23, 4.7), ("F 900 GS", 2024, NOW, "mid", 219, 14.5, 4.4), ("F 900 GS Adventure", 2024, NOW, "big", 227, 23, 4.5),
     ("G 310 GS", 2018, NOW, "light", 175, 11, 3.3), ("G 310 R", 2017, NOW, "street", 164, 11, 3.3), ("F 900 R", 2020, NOW, "street", 211, 13, 4.5),
     ("F 900 XR", 2020, NOW, "street", 219, 15.5, 4.6), ("R nineT", 2014, 2024, "street", 222, 18, 5.3), ("R nineT Scrambler", 2017, 2024, "street", 220, 17, 5.3),
     ("R nineT Urban G/S", 2017, 2023, "street", 221, 17, 5.3), ("R 12 nineT", 2024, NOW, "street", 220, 16, 5.3), ("R 12", 2024, NOW, "street", 227, 14, 5.3),
     ("R 12 G/S", 2025, NOW, "big", 229, 15.5, 5.3), ("R 18", 2021, NOW, "street", 345, 16, 5.6), ("R 1200 R", 2007, 2018, "street", 231, 18, 5.0),
     ("R 1250 R", 2019, 2024, "street", 239, 18, 4.8), ("R 1300 R", 2025, NOW, "street", 239, 17, 4.8), ("R 1200 RT", 2005, 2018, "street", 274, 25, 5.2),
     ("R 1250 RT", 2019, 2024, "street", 279, 25, 5.0), ("R 1300 RT", 2025, NOW, "street", 281, 24, 5.0), ("R 1250 RS", 2019, 2024, "street", 243, 18, 4.8),
     ("R 1150 RT", 2002, 2005, "street", 279, 25, 5.5), ("R 1100 RT", 1996, 2001, "street", 282, 26, 5.5), ("K 1200 LT", 1999, 2009, "street", 378, 24, 6.5),
     ("K 1300 S", 2009, 2016, "street", 254, 19, 6.0), ("K 1600 GT", 2012, NOW, "street", 334, 26.5, 6.0), ("K 1600 GTL", 2012, NOW, "street", 350, 26.5, 6.0),
     ("K 1600 B", 2018, NOW, "street", 336, 26.5, 6.0), ("S 1000 RR", 2010, NOW, "street", 197, 16.5, 6.5), ("S 1000 R", 2014, NOW, "street", 199, 16.5, 6.4),
     ("S 1000 XR", 2016, NOW, "street", 226, 20, 6.3), ("M 1000 RR", 2021, NOW, "street", 192, 16.5, 6.6), ("M 1000 XR", 2024, NOW, "street", 223, 20, 6.4),
     ("C 400 X", 2019, NOW, "street", 204, 12.8, 3.5), ("CE 04", 2022, NOW, "street", 231, 0, 0))

make("Honda",
     *dirt("", [("CRF50F", 2004, NOW, "pw"), ("XR50R", 2000, 2003, "pw"), ("XR70R", 1997, 2003, "kid110"), ("CRF70F", 2004, 2012, "kid110"),
                ("XR80R", 1985, 2003, "kid110"), ("CRF80F", 2004, 2013, "kid110"), ("XR100R", 1985, 2003, "kid110"), ("CRF100F", 2004, 2013, "kid110"),
                ("CRF110F", 2013, NOW, "kid110"), ("CRF125F", 2014, NOW, "kid125"), ("CRF125FB", 2014, NOW, "kid125"), ("CRF150F", 2003, 2017, "kid150"),
                ("CRF230F", 2003, 2019, "trail230"), ("CRF250F", 2019, NOW, "trail230"), ("XR200R", 1984, 2002, "trail230"), ("XR250R", 1986, 2004, "en250"),
                ("XR400R", 1996, 2004, "en450"), ("XR600R", 1985, 2000, "en600"), ("XR650R", 2000, 2007, "en600"), ("CR80R", 1981, 2002, "mini85"),
                ("CR85R", 2003, 2007, "mini85"), ("CRF150R", 2007, NOW, "mini112"), ("CR125R", 1981, 2007, "mx125"), ("CR250R", 1981, 2007, "mx250t"),
                ("CR500R", 1984, 2001, "mx500t"), ("CRF250R", 2004, NOW, "mx250"), ("CRF450R", 2002, NOW, "mx450"), ("CRF250RX", 2019, NOW, "en250"),
                ("CRF450RX", 2017, NOW, "en450"), ("CRF250X", 2004, 2017, "en250"), ("CRF450X", 2005, NOW, "en450"), ("CRF450L", 2019, 2020, "en450"),
                ("CRF450RL", 2021, NOW, "en450")]),
     ("XL250R", 1982, 1987, "light", 125, 9.5, 3.0), ("XL350R", 1984, 1985, "light", 135, 10, 3.5), ("XL600R", 1983, 1987, "light", 145, 11, 4.5),
     ("NX650", 1988, 1989, "light", 160, 13, 4.5), ("XR250L", 1991, 1996, "light", 125, 10, 3.0), ("XR650L", 1993, NOW, "light", 157, 10.5, 5.0),
     ("CRF230L", 2008, 2009, "light", 120, 8, 2.8), ("CRF250L", 2013, 2020, "light", 146, 7.8, 3.0), ("CRF250L Rally", 2017, 2020, "light", 157, 10.1, 3.0),
     ("CRF300L", 2021, NOW, "light", 140, 7.8, 2.9), ("CRF300L Rally", 2021, NOW, "light", 153, 12.8, 2.9),
     ("XL600V Transalp", 1989, 1990, "mid", 200, 18, 5.0), ("XL750 Transalp", 2024, NOW, "mid", 208, 16.9, 4.3), ("XRV750 Africa Twin", 1990, 2003, "big", 230, 23, 5.5),
     ("CRF1000L Africa Twin", 2016, 2019, "big", 232, 18.8, 5.1), ("CRF1000L Africa Twin Adventure Sports", 2018, 2019, "big", 243, 24.2, 5.2),
     ("CRF1100L Africa Twin", 2020, NOW, "big", 226, 18.8, 5.0), ("CRF1100L Africa Twin Adventure Sports", 2020, NOW, "big", 250, 24.8, 5.1),
     ("CB500X", 2013, 2023, "mid", 196, 17.7, 3.6), ("NX500", 2024, NOW, "mid", 196, 17.5, 3.6), ("NC700X", 2012, 2013, "street", 218, 14.1, 3.5),
     ("NC750X", 2014, NOW, "street", 214, 14.1, 3.5), ("NT1100", 2022, NOW, "street", 238, 20.4, 4.8), ("CB500F", 2013, NOW, "street", 189, 17.1, 3.6),
     ("CBR500R", 2013, NOW, "street", 192, 17.1, 3.6), ("CB300R", 2019, NOW, "street", 143, 10, 3.0), ("CBR300R", 2015, 2022, "street", 162, 13, 3.0),
     ("CBR250R", 2011, 2014, "street", 161, 13, 3.0), ("Rebel 250", 1985, 2016, "street", 150, 10.5, 3.0), ("Rebel 300", 2017, NOW, "street", 165, 11.2, 3.0),
     ("Rebel 500", 2017, NOW, "street", 191, 11.2, 3.6), ("Rebel 1100", 2021, NOW, "street", 223, 13.6, 5.0), ("CB650R", 2019, NOW, "street", 203, 15.4, 5.0),
     ("CBR650R", 2019, NOW, "street", 208, 15.4, 5.0), ("CB650F", 2015, 2018, "street", 208, 17.3, 5.0), ("CBR650F", 2014, 2018, "street", 211, 17.3, 5.0),
     ("CBR600RR", 2003, NOW, "street", 194, 18, 6.0), ("CBR600F4i", 2001, 2006, "street", 200, 18, 6.0), ("CBR1000RR", 2004, 2019, "street", 196, 16, 6.5),
     ("CBR1000RR-R Fireblade", 2021, NOW, "street", 201, 16.1, 6.7), ("CB1000R", 2019, 2025, "street", 213, 16.2, 6.0), ("CB1100", 2013, 2021, "street", 248, 16.8, 5.5),
     ("VFR800", 1998, 2017, "street", 244, 21.5, 5.8), ("VFR1200F", 2010, 2017, "street", 267, 18.5, 6.5), ("ST1300", 2003, 2013, "street", 331, 29, 6.0),
     ("Gold Wing", 1981, NOW, "street", 383, 21, 6.0), ("Gold Wing Tour", 2018, NOW, "street", 390, 21, 6.0), ("Shadow 750", 1997, 2019, "street", 249, 14, 4.8),
     ("Shadow Aero", 2004, 2019, "street", 251, 14, 4.8), ("Shadow Phantom", 2010, 2019, "street", 249, 14, 4.8), ("VTX1300", 2003, 2009, "street", 316, 18, 6.0),
     ("VTX1800", 2002, 2008, "street", 340, 17, 6.5), ("Fury", 2010, 2020, "street", 303, 12.8, 5.8), ("Grom", 2014, NOW, "street", 102, 6, 1.7),
     ("Monkey", 2019, NOW, "street", 104, 5.6, 1.7), ("Super Cub C125", 2019, NOW, "street", 109, 3.7, 1.5), ("Navi", 2022, NOW, "street", 107, 3.4, 1.8),
     ("PCX", 2011, NOW, "street", 132, 8.1, 2.2), ("ADV160", 2023, NOW, "street", 133, 8.1, 2.3), ("ADV150", 2021, 2022, "street", 133, 8, 2.3),
     ("Forza 750 / X-ADV", 2021, NOW, "street", 236, 13.2, 3.7), ("Hawk 11", 2023, NOW, "street", 214, 15, 5.5), ("CB750 Hornet", 2023, NOW, "street", 190, 15.2, 4.4),
     ("Transalp XL650V", 2000, 2007, "mid", 214, 19, 5.0))

make("Yamaha",
     *dirt("", [("PW50", 1981, NOW, "pw"), ("PW80", 1983, 2006, "kid110"), ("TT-R50E", 2006, NOW, "pw"), ("TT-R90", 2000, 2007, "kid110"),
                ("TT-R110E", 2008, NOW, "kid110"), ("TT-R125LE", 2000, NOW, "kid125"), ("TT-R225", 1999, 2004, "trail230"), ("TT-R230", 2005, NOW, "trail230"),
                ("TT-R250", 1999, 2006, "en250"), ("XT250 (off-road)", 1981, 1983, "trail230"), ("YZ65", 2018, NOW, "mini65"), ("YZ80", 1981, 2001, "mini85"),
                ("YZ85", 2002, NOW, "mini85"), ("YZ125", 1981, NOW, "mx125"), ("YZ125X", 2020, NOW, "en125"), ("YZ250", 1981, NOW, "mx250t"),
                ("YZ250X", 2016, NOW, "en250t"), ("YZ490", 1982, 1990, "mx500t"), ("YZ400F", 1998, 1999, "mx450"), ("YZ426F", 2000, 2002, "mx450"),
                ("YZ250F", 2001, NOW, "mx250"), ("YZ450F", 2003, NOW, "mx450"), ("YZ250FX", 2015, NOW, "en250"), ("YZ450FX", 2016, NOW, "en450"),
                ("WR250F", 2001, NOW, "en250"), ("WR400F", 1998, 2000, "en450"), ("WR426F", 2001, 2002, "en450"), ("WR450F", 2003, NOW, "en450"),
                ("WR200", 1992, 1997, "en250t"), ("WR250 (2-stroke)", 1991, 1997, "en250t")]),
     ("XT225", 1992, 2007, "light", 118, 9.5, 2.6), ("XT250", 2008, NOW, "light", 131, 9.8, 2.6), ("XT350", 1985, 2000, "light", 128, 11, 3.2),
     ("XT600", 1984, 1995, "light", 150, 13, 4.5), ("TW200", 1987, NOW, "light", 126, 7, 2.5), ("Serow 250", 2005, 2020, "light", 130, 9.6, 2.6),
     ("WR250R", 2008, 2020, "light", 134, 7.6, 3.2), ("WR250X", 2008, 2011, "street", 136, 7.6, 3.2), ("XT660Z Ténéré", 2008, 2016, "mid", 206, 23, 4.5),
     ("XT660R", 2004, 2016, "light", 181, 15, 4.5), ("XT1200Z Super Ténéré", 2012, 2021, "big", 265, 23, 5.6), ("XT1200ZE Super Ténéré ES", 2014, 2021, "big", 267, 23, 5.6),
     ("Ténéré 700", 2021, NOW, "mid", 204, 16, 4.3), ("Ténéré 700 Rally Edition", 2023, 2024, "mid", 205, 16, 4.3), ("Ténéré 700 World Raid", 2023, NOW, "mid", 220, 23, 4.4),
     ("Ténéré 700 Explore", 2025, NOW, "mid", 205, 16, 4.3), ("Super Ténéré XTZ750", 1989, 1997, "big", 220, 26, 5.5),
     ("Tracer 9 GT", 2021, NOW, "street", 220, 19, 5.0), ("Tracer 900 GT", 2019, 2020, "street", 227, 18, 5.2), ("FJ-09", 2015, 2018, "street", 210, 18, 5.2),
     ("Tracer 7", 2021, NOW, "street", 196, 17, 4.3), ("MT-03", 2020, NOW, "street", 168, 14, 3.4), ("MT-07", 2015, NOW, "street", 184, 14, 4.2),
     ("FZ-07", 2015, 2017, "street", 182, 14, 4.2), ("MT-09", 2017, NOW, "street", 193, 14, 5.0), ("FZ-09", 2014, 2016, "street", 188, 14, 5.0),
     ("MT-10", 2017, NOW, "street", 212, 17, 6.5), ("FZ1", 2001, 2015, "street", 220, 18, 6.0), ("FZ6", 2004, 2009, "street", 208, 19.4, 5.5),
     ("YZF-R3", 2015, NOW, "street", 169, 14, 3.4), ("YZF-R7", 2022, NOW, "street", 188, 13, 4.3), ("YZF-R6", 1999, 2020, "street", 190, 17, 6.0),
     ("YZF-R1", 1998, NOW, "street", 201, 17, 6.8), ("XSR700", 2018, NOW, "street", 186, 14, 4.2), ("XSR900", 2016, NOW, "street", 195, 14, 5.0),
     ("XSR125", 2022, NOW, "street", 140, 10, 2.3), ("SR400", 1978, 2021, "street", 174, 12, 3.5), ("FJR1300", 2003, 2022, "street", 289, 25, 6.0),
     ("V Star 250", 2008, 2021, "street", 147, 9.5, 3.0), ("V Star 650", 1998, 2016, "street", 247, 16, 4.8), ("V Star 950", 2009, 2017, "street", 278, 17, 5.2),
     ("V Star 1100", 1999, 2009, "street", 280, 17, 5.8), ("V Star 1300", 2007, 2017, "street", 330, 18.5, 5.9), ("Bolt", 2014, 2021, "street", 247, 12, 5.0),
     ("Raider", 2008, 2017, "street", 331, 15.8, 6.5), ("Stryker", 2011, 2017, "street", 293, 15, 6.0), ("Road Star", 1999, 2014, "street", 330, 18, 6.5),
     ("VMAX", 1985, 2020, "street", 310, 15, 8.0), ("Virago 250", 1988, 2007, "street", 147, 9.5, 3.0), ("Virago 750 / 1100", 1981, 1999, "street", 230, 13.5, 6.0),
     ("Zuma 125", 2009, NOW, "street", 128, 6, 2.5), ("SMAX", 2015, 2018, "street", 120, 7.4, 2.4), ("XMAX", 2018, NOW, "street", 184, 13, 3.2),
     ("TMAX", 2001, NOW, "street", 220, 15, 4.8), ("Majesty 400", 2004, 2009, "street", 211, 14, 4.0))

make("Suzuki",
     *dirt("", [("DR-Z50", 2016, NOW, "pw"), ("JR50", 1981, 2006, "pw"), ("DR-Z70", 2008, 2025, "kid110"), ("DR-Z110", 2003, 2005, "kid110"),
                ("DR-Z125L", 2003, NOW, "kid125"), ("DR-Z250", 2001, 2007, "trail230"), ("DR-Z400E", 2000, 2007, "en450"), ("DR350", 1990, 1999, "en350"),
                ("RM80", 1981, 2001, "mini85"), ("RM85", 2002, NOW, "mini85"), ("RM125", 1981, 2008, "mx125"), ("RM250", 1981, 2012, "mx250t"),
                ("RMX250", 1989, 1998, "en250t"), ("RM-Z250", 2004, NOW, "mx250"), ("RM-Z450", 2005, NOW, "mx450"), ("RMX450Z", 2010, 2019, "en450")]),
     ("DR200SE", 1996, 2013, "light", 126, 13, 2.8), ("DR350S / SE", 1990, 1999, "light", 135, 10, 3.5), ("DR650S", 1990, 1995, "light", 158, 13, 4.5),
     ("DR650SE", 1996, 2021, "light", 166, 13, 4.5), ("DR650S (2022)", 2022, NOW, "light", 166, 13, 4.5), ("DR-Z400S", 2000, 2024, "light", 144, 10, 4.0),
     ("DR-Z400SM", 2005, 2024, "street", 146, 10, 4.0), ("DR-Z4S", 2025, NOW, "light", 151, 8.7, 4.0), ("DR-Z4SM", 2025, NOW, "street", 154, 8.7, 4.0),
     ("DR-Z400E plated", 2000, 2007, "enduro", 132, 10, 4.2), ("DR Big DR800S", 1990, 1999, "big", 205, 24, 5.8),
     ("V-Strom 650 (DL650)", 2004, NOW, "mid", 214, 20, 4.4), ("V-Strom 650XT", 2015, NOW, "mid", 216, 20, 4.4), ("V-Strom 1000 (DL1000)", 2002, 2020, "big", 233, 20, 5.5),
     ("V-Strom 1050", 2020, 2022, "big", 247, 20, 5.3), ("V-Strom 1050XT", 2020, 2022, "big", 247, 20, 5.3), ("V-Strom 1050DE", 2023, NOW, "big", 252, 20, 5.3),
     ("V-Strom 800DE", 2023, NOW, "big", 230, 20, 4.5), ("V-Strom 800", 2024, NOW, "mid", 223, 20, 4.4), ("V-Strom 250SX", 2024, NOW, "light", 167, 12, 3.0),
     ("TU250X", 2009, 2020, "street", 148, 12, 2.7), ("GZ250", 1999, 2010, "street", 140, 10.5, 3.0), ("GS500", 1989, 2009, "street", 189, 20, 4.5),
     ("SV650", 1999, NOW, "street", 199, 13.8, 4.4), ("SV650X", 2018, NOW, "street", 197, 13.8, 4.4), ("Gladius", 2009, 2015, "street", 202, 14.5, 4.5),
     ("GSX-8S", 2023, NOW, "street", 202, 14, 4.4), ("GSX-8R", 2024, NOW, "street", 205, 14, 4.4), ("GSX250R", 2018, NOW, "street", 181, 15, 3.2),
     ("GSX-R600", 1997, NOW, "street", 187, 17, 6.0), ("GSX-R750", 1985, NOW, "street", 190, 17, 6.2), ("GSX-R1000", 2001, NOW, "street", 203, 16, 6.8),
     ("GSX-S750", 2015, 2023, "street", 213, 16, 5.5), ("GSX-S1000", 2016, NOW, "street", 214, 19, 6.0), ("GSX-S1000GT", 2022, NOW, "street", 226, 19, 5.8),
     ("Katana", 2020, NOW, "street", 215, 12, 6.0), ("Hayabusa", 1999, NOW, "street", 264, 20, 7.0), ("Bandit 1250S", 2007, 2012, "street", 250, 19, 6.0),
     ("Bandit 600 / 1200", 1995, 2006, "street", 230, 20, 6.0), ("Boulevard S40", 2005, 2019, "street", 173, 10.6, 4.0), ("Boulevard C50", 2005, 2019, "street", 277, 15.5, 5.2),
     ("Boulevard M50", 2005, 2019, "street", 269, 15.5, 5.2), ("Boulevard M109R", 2006, 2020, "street", 347, 19.5, 7.0), ("Boulevard C90", 2005, 2015, "street", 345, 18, 6.5),
     ("Burgman 200", 2014, 2022, "street", 163, 10.5, 2.8), ("Burgman 400", 1999, NOW, "street", 215, 13.5, 3.8), ("Burgman 650", 2003, 2018, "street", 277, 15, 5.0),
     ("Intruder 800 / 1400", 1987, 2004, "street", 250, 13, 5.5), ("Savage LS650", 1986, 2004, "street", 160, 10.5, 4.0))

make("Kawasaki",
     *dirt("", [("KLX110", 2002, NOW, "kid110"), ("KLX110L", 2010, NOW, "kid110"), ("KLX140", 2008, NOW, "kid125"), ("KLX140L", 2008, NOW, "kid150"),
                ("KLX230R", 2020, NOW, "trail230"), ("KLX300R", 2020, NOW, "en250"), ("KLX250R", 1994, 2004, "en250"), ("KLX300R (1990s)", 1997, 2007, "en350"),
                ("KLX450R", 2008, 2021, "en450"), ("KLX650R", 1993, 2002, "en600"), ("KDX200", 1986, 2006, "en250t"), ("KDX220R", 1997, 2005, "en250t"),
                ("KX65", 2000, NOW, "mini65"), ("KX80", 1981, 2000, "mini85"), ("KX85", 2001, NOW, "mini85"), ("KX100", 1989, 2012, "mini112"),
                ("KX112", 2022, NOW, "mini112"), ("KX125", 1981, 2008, "mx125"), ("KX250 (2-stroke)", 1981, 2008, "mx250t"), ("KX500", 1983, 2004, "mx500t"),
                ("KX250F", 2004, 2018, "mx250"), ("KX250", 2019, NOW, "mx250"), ("KX450F", 2006, 2018, "mx450"), ("KX450", 2019, NOW, "mx450"),
                ("KX250X", 2021, NOW, "en250"), ("KX450X", 2021, NOW, "en450"), ("KX450XC", 2016, 2018, "en450")]),
     ("KLR650", 1987, 2018, "mid", 196, 23, 4.8), ("KLR650 (2022)", 2022, NOW, "mid", 209, 23, 4.6), ("KLR650 Adventure", 2022, NOW, "mid", 221, 23, 4.6),
     ("KLR650 S", 2023, NOW, "mid", 207, 23, 4.6), ("KLR250", 1985, 2005, "light", 133, 10.5, 3.0), ("KL250 Super Sherpa", 2000, 2009, "light", 129, 9, 2.8),
     ("KLX250S", 2006, 2014, "light", 136, 7.7, 3.0), ("KLX250", 2018, 2020, "light", 137, 7.7, 3.0), ("KLX250SF", 2009, 2014, "street", 137, 7.7, 3.0),
     ("KLX300", 2021, NOW, "light", 136, 7.6, 3.0), ("KLX300SM", 2021, NOW, "street", 136, 7.6, 3.0), ("KLX230", 2020, NOW, "light", 134, 7.6, 2.6),
     ("KLX230 S", 2022, NOW, "light", 132, 7.6, 2.6), ("KLX230SM", 2023, NOW, "street", 134, 7.6, 2.6), ("KLE500", 1991, 2007, "mid", 199, 15, 4.8),
     ("Versys-X 300", 2017, 2024, "light", 175, 17, 3.4), ("Versys 650", 2008, NOW, "mid", 219, 21, 4.6), ("Versys 1000", 2015, NOW, "big", 257, 21, 6.0),
     ("Ninja 250R", 1986, 2012, "street", 170, 18, 3.5), ("Ninja 300", 2013, 2017, "street", 172, 17, 3.5), ("Ninja 400", 2018, 2023, "street", 168, 14, 3.6),
     ("Ninja 500", 2024, NOW, "street", 171, 14, 3.6), ("Ninja 650", 2006, NOW, "street", 193, 15, 4.5), ("Ninja ZX-6R", 1995, NOW, "street", 196, 17, 6.0),
     ("Ninja ZX-10R", 2004, NOW, "street", 207, 17, 7.0), ("Ninja ZX-14R", 2006, 2020, "street", 268, 22, 7.0), ("Ninja 1000SX", 2011, NOW, "street", 235, 19, 6.0),
     ("Ninja H2", 2015, NOW, "street", 238, 17, 8.0), ("Ninja H2 SX", 2018, NOW, "street", 260, 19, 6.5), ("Z125 Pro", 2017, 2023, "street", 102, 7.4, 1.8),
     ("Z400", 2019, 2023, "street", 167, 14, 3.6), ("Z500", 2024, NOW, "street", 167, 14, 3.6), ("Z650", 2017, NOW, "street", 188, 15, 4.5),
     ("Z650RS", 2022, NOW, "street", 187, 12, 4.5), ("Z900", 2017, NOW, "street", 210, 17, 5.5), ("Z900RS", 2018, NOW, "street", 215, 17, 5.5),
     ("Z1000", 2003, 2016, "street", 221, 17, 6.5), ("Z H2", 2020, NOW, "street", 240, 19, 7.0), ("W800", 2011, NOW, "street", 224, 15, 4.6),
     ("Eliminator", 2024, NOW, "street", 176, 13, 3.6), ("Vulcan S", 2015, NOW, "street", 226, 14, 4.6), ("Vulcan 500", 1990, 2009, "street", 198, 15, 4.5),
     ("Vulcan 750", 1986, 2006, "street", 236, 13.5, 5.5), ("Vulcan 900", 2006, NOW, "street", 281, 20, 5.5), ("Vulcan 1500 / 1600", 1987, 2008, "street", 315, 20, 6.0),
     ("Vulcan 1700 Voyager", 2009, NOW, "street", 403, 20, 6.0), ("Vulcan 2000", 2004, 2010, "street", 380, 21, 7.0), ("Concours 14", 2008, 2016, "street", 313, 22, 6.5),
     ("Concours 1000 (ZG1000)", 1986, 2006, "street", 290, 28, 6.5), ("KZ1000 Police", 1981, 2005, "street", 260, 22, 6.5), ("Ninja 7 Hybrid", 2024, NOW, "street", 227, 11, 2.8),
     ("Super Sherpa (KL250G)", 2000, 2009, "light", 129, 9, 2.8))

make("Triumph",
     ("Tiger 885i", 1999, 2000, "big", 240, 24, 6.0), ("Tiger 955i", 2001, 2006, "big", 238, 24, 6.0), ("Tiger 1050", 2007, 2013, "street", 228, 20, 6.0),
     ("Tiger 800", 2011, 2019, "mid", 210, 19, 4.8), ("Tiger 800 XC", 2011, 2019, "mid", 215, 19, 4.8), ("Tiger 800 XCx", 2015, 2019, "mid", 220, 19, 4.8),
     ("Tiger 800 XRx", 2015, 2019, "mid", 213, 19, 4.8), ("Tiger 900 GT", 2020, NOW, "big", 219, 20, 5.0), ("Tiger 900 GT Pro", 2020, NOW, "big", 222, 20, 5.0),
     ("Tiger 900 Rally", 2020, 2023, "big", 219, 20, 5.0), ("Tiger 900 Rally Pro", 2020, NOW, "big", 228, 20, 5.0), ("Tiger 850 Sport", 2021, NOW, "mid", 212, 20, 4.9),
     ("Tiger Explorer 1200", 2012, 2015, "big", 259, 20, 5.8), ("Tiger Explorer XC", 2013, 2016, "big", 267, 20, 5.8), ("Tiger 1200 XCx / XRx", 2016, 2021, "big", 259, 20, 5.8),
     ("Tiger 1200 GT Pro", 2022, NOW, "big", 245, 20, 5.6), ("Tiger 1200 GT Explorer", 2022, NOW, "big", 255, 30, 5.6), ("Tiger 1200 Rally Pro", 2022, NOW, "big", 249, 20, 5.6),
     ("Tiger 1200 Rally Explorer", 2022, NOW, "big", 261, 30, 5.6), ("Tiger Sport 660", 2022, NOW, "street", 206, 17.2, 4.4), ("Tiger Sport 800", 2025, NOW, "street", 214, 18.6, 4.8),
     ("Scrambler 400 X", 2024, NOW, "light", 185, 13, 3.4), ("Scrambler 900", 2017, NOW, "street", 223, 12, 4.4), ("Scrambler 1200 XC", 2019, 2023, "big", 230, 15, 5.0),
     ("Scrambler 1200 XE", 2019, NOW, "big", 230, 15, 5.0), ("Scrambler 1200 X", 2024, NOW, "big", 228, 15, 5.0), ("Scrambler (2006-2016)", 2006, 2016, "street", 230, 16, 5.0),
     ("Speed 400", 2024, NOW, "street", 170, 13, 3.4), ("Trident 660", 2021, NOW, "street", 189, 14, 4.6), ("Daytona 660", 2024, NOW, "street", 201, 14, 4.6),
     ("Street Triple", 2008, NOW, "street", 189, 15, 5.2), ("Speed Triple", 1994, NOW, "street", 198, 15.5, 6.5), ("Daytona 675", 2006, 2018, "street", 184, 17.4, 5.8),
     ("Bonneville T100", 2001, NOW, "street", 228, 14.5, 4.2), ("Bonneville T120", 2016, NOW, "street", 236, 14.5, 4.4), ("Bonneville Bobber", 2017, NOW, "street", 251, 12, 4.6),
     ("Bonneville Speedmaster", 2018, NOW, "street", 262, 12, 4.6), ("Speed Twin 900 / 1200", 2019, NOW, "street", 216, 14.5, 4.7), ("Thruxton", 2004, 2024, "street", 218, 14.5, 4.6),
     ("Street Twin", 2016, 2022, "street", 216, 12, 4.4), ("Street Scrambler", 2017, 2022, "street", 223, 12, 4.4), ("Rocket III / Rocket 3", 2004, NOW, "street", 318, 18, 7.5),
     ("Thunderbird", 2010, 2018, "street", 339, 22, 6.0), ("America / Speedmaster (old)", 2002, 2017, "street", 250, 19, 5.5), ("Sprint ST / GT", 1999, 2016, "street", 268, 20, 6.0),
     ("Trophy SE", 2013, 2017, "street", 301, 26, 6.0), ("TF 250-X", 2024, NOW, "enduro", 106, 7.2, 5.5), ("TF 250-E", 2025, NOW, "enduro", 110, 8.3, 4.5),
     ("TF 450-RC", 2025, NOW, "enduro", 110, 7.2, 6.5), ("TF 450-X", 2025, NOW, "enduro", 113, 8.3, 5.0))

make("Ducati",
     ("DesertX", 2023, NOW, "big", 223, 21, 5.6), ("DesertX Rally", 2024, NOW, "big", 211, 21, 5.6), ("DesertX Discovery", 2025, NOW, "big", 229, 21, 5.6),
     ("Multistrada 1000 DS / 1100", 2003, 2009, "street", 220, 20, 6.0), ("Multistrada 1200", 2010, 2017, "big", 232, 20, 6.0), ("Multistrada 1200 Enduro", 2016, 2018, "big", 254, 30, 6.2),
     ("Multistrada 1260", 2018, 2020, "big", 232, 20, 6.0), ("Multistrada 1260 Enduro", 2019, 2021, "big", 254, 30, 6.2), ("Multistrada 950", 2017, 2021, "big", 227, 20, 5.5),
     ("Multistrada V2", 2022, NOW, "big", 222, 20, 5.5), ("Multistrada V4", 2021, NOW, "big", 240, 22, 6.4), ("Multistrada V4 Rally", 2023, NOW, "big", 260, 30, 6.4),
     ("Multistrada V4 Pikes Peak", 2022, NOW, "street", 233, 22, 6.6), ("Scrambler Icon", 2015, NOW, "street", 185, 13.5, 5.2), ("Scrambler Full Throttle", 2015, NOW, "street", 185, 13.5, 5.2),
     ("Scrambler Desert Sled", 2017, 2022, "mid", 207, 13.5, 5.2), ("Scrambler 1100", 2018, 2024, "street", 211, 15, 5.5), ("Scrambler Sixty2", 2016, 2020, "street", 183, 14, 5.0),
     ("Monster 797 / 821", 2015, 2020, "street", 195, 16.5, 5.4), ("Monster 696 / 796 / 1100", 2008, 2014, "street", 185, 13.5, 5.5), ("Monster 1200", 2014, 2021, "street", 213, 16.5, 5.8),
     ("Monster (937)", 2021, NOW, "street", 188, 14, 5.3), ("Monster (old, 600-1000)", 1993, 2008, "street", 190, 16, 5.5), ("Panigale V2", 2020, NOW, "street", 200, 17, 6.0),
     ("Panigale V4", 2018, NOW, "street", 198, 16, 7.0), ("Panigale 899 / 959 / 1299", 2012, 2020, "street", 195, 17, 6.5), ("1098 / 1198 / 848", 2007, 2013, "street", 190, 15.5, 6.5),
     ("999 / 749 / 998 / 996 / 916", 1994, 2006, "street", 210, 17, 6.5), ("Hypermotard 950", 2019, NOW, "street", 200, 14.5, 5.5), ("Hypermotard 821 / 939", 2013, 2018, "street", 198, 16, 5.5),
     ("Hypermotard 1100 / 796", 2007, 2012, "street", 190, 12.4, 5.5), ("Hypermotard 698 Mono", 2024, NOW, "street", 151, 12, 4.8), ("Hyperstrada", 2013, 2018, "street", 204, 16, 5.5),
     ("Diavel", 2011, NOW, "street", 239, 17, 6.5), ("XDiavel", 2016, NOW, "street", 247, 18, 6.5), ("Streetfighter V2", 2022, NOW, "street", 200, 17, 6.0),
     ("Streetfighter V4", 2020, NOW, "street", 201, 16, 7.0), ("SuperSport 939 / 950", 2017, 2025, "street", 210, 16, 5.8), ("ST2 / ST3 / ST4", 1997, 2007, "street", 230, 21, 6.0),
     ("SportClassic / GT1000", 2006, 2010, "street", 200, 15, 5.8))

make("Harley-Davidson",
     ("Pan America 1250", 2021, NOW, "big", 245, 21.2, 5.8), ("Pan America 1250 Special", 2021, NOW, "big", 258, 21.2, 5.8), ("Pan America 1250 ST", 2025, NOW, "street", 245, 21.2, 5.8),
     ("Sportster 883 / Iron 883", 1986, 2022, "street", 256, 12.5, 5.0), ("Sportster 1200 / Forty-Eight / Seventy-Two", 1988, 2022, "street", 255, 12.5, 5.3), ("Sportster S", 2021, NOW, "street", 228, 11.8, 5.5),
     ("Nightster", 2022, NOW, "street", 221, 11.7, 5.0), ("Street 500 / 750", 2015, 2020, "street", 233, 13.1, 4.5), ("Street Rod", 2017, 2020, "street", 236, 13.1, 4.8),
     ("X 350 / X 440", 2024, NOW, "street", 195, 13.5, 3.8), ("LiveWire", 2020, NOW, "street", 249, 0, 0), ("Dyna (Super Glide, Fat Bob, Wide Glide, Low Rider)", 1991, 2017, "street", 300, 18, 5.8),
     ("Softail (Fat Boy, Heritage, Slim, Deluxe)", 1984, NOW, "street", 320, 18.9, 5.8), ("Street Bob", 2018, NOW, "street", 297, 13.2, 5.6), ("Low Rider S / ST", 2020, NOW, "street", 308, 18.9, 5.8),
     ("Fat Bob", 2018, NOW, "street", 306, 13.6, 5.8), ("Breakout", 2013, NOW, "street", 310, 18.9, 5.8), ("Sport Glide", 2018, 2021, "street", 304, 18.9, 5.8),
     ("Street Glide", 2006, NOW, "street", 368, 22.7, 6.0), ("Road Glide", 1998, NOW, "street", 380, 22.7, 6.0), ("Road King", 1994, NOW, "street", 375, 22.7, 6.0),
     ("Electra Glide / Ultra Limited", 1981, NOW, "street", 410, 22.7, 6.3), ("Tri Glide", 2009, NOW, "street", 562, 22.7, 7.0), ("V-Rod / Night Rod", 2002, 2017, "street", 305, 18.9, 6.5),
     ("Heritage Classic", 1986, NOW, "street", 330, 18.9, 5.8), ("CVO (all)", 1999, NOW, "street", 390, 22.7, 6.3))

make("Royal Enfield",
     ("Himalayan 411", 2018, 2023, "mid", 199, 15, 3.3), ("Himalayan 450", 2024, NOW, "mid", 196, 17, 3.4), ("Scram 411", 2022, NOW, "light", 185, 15, 3.3),
     ("Bear 650", 2025, NOW, "mid", 216, 13.7, 4.0), ("Guerrilla 450", 2025, NOW, "street", 185, 11, 3.4), ("Bullet 500 / 350", 1981, NOW, "street", 191, 13.5, 3.2),
     ("Classic 350 / 500", 2009, NOW, "street", 195, 13, 3.2), ("Interceptor 650", 2019, NOW, "street", 217, 13.7, 4.0), ("Continental GT 650", 2019, NOW, "street", 212, 12.5, 4.0),
     ("Continental GT 535", 2014, 2018, "street", 184, 13.5, 3.5), ("Meteor 350", 2021, NOW, "street", 191, 15, 3.0), ("Hunter 350", 2023, NOW, "street", 181, 13, 2.8),
     ("Super Meteor 650", 2023, NOW, "street", 241, 15.7, 4.3), ("Shotgun 650", 2024, NOW, "street", 240, 13.8, 4.3), ("Classic 650", 2025, NOW, "street", 243, 14.7, 4.3))

make("Aprilia",
     ("Tuareg 660", 2022, NOW, "mid", 204, 18, 4.5), ("ETV 1000 Caponord", 2002, 2007, "big", 250, 25, 6.5), ("Caponord 1200", 2014, 2017, "big", 255, 24, 6.0),
     ("Pegaso 650", 1992, 2009, "light", 190, 22, 4.5), ("RXV 450 / 550", 2006, 2013, "enduro", 120, 7.8, 5.5), ("SXV 450 / 550", 2006, 2013, "street", 120, 7.8, 5.5),
     ("RX 125 / SX 125", 2018, NOW, "light", 134, 7, 2.5), ("RS 457", 2025, NOW, "street", 175, 12.7, 3.6), ("Tuono 457", 2025, NOW, "street", 174, 12.7, 3.6),
     ("RS 660", 2021, NOW, "street", 183, 15, 4.8), ("Tuono 660", 2021, NOW, "street", 183, 15, 4.8), ("Tuono V4", 2011, NOW, "street", 209, 18.5, 7.0),
     ("RSV4", 2009, NOW, "street", 202, 17.9, 7.5), ("RSV Mille / Tuono 1000", 1998, 2010, "street", 210, 18, 7.0), ("Shiver 750 / 900", 2008, 2020, "street", 218, 15, 5.5),
     ("Dorsoduro 750 / 900 / 1200", 2008, 2020, "street", 212, 12, 5.5), ("Mana 850", 2008, 2016, "street", 230, 16, 5.0), ("SR GT 200", 2023, NOW, "street", 148, 9, 2.6))

make("Moto Guzzi",
     ("Stelvio 1200", 2009, 2010, "big", 251, 18, 6.0), ("Stelvio 1200 NTX", 2011, 2017, "big", 272, 32, 6.0), ("Stelvio", 2024, NOW, "big", 246, 21, 5.3),
     ("V85 TT", 2020, NOW, "mid", 229, 23, 4.9), ("V85 TT Travel", 2020, NOW, "mid", 238, 23, 4.9), ("V7", 2008, NOW, "street", 218, 21, 4.8),
     ("V9 Bobber / Roamer", 2016, NOW, "street", 210, 15, 4.8), ("V100 Mandello", 2023, NOW, "street", 233, 17, 5.0), ("Griso", 2006, 2016, "street", 243, 16.7, 6.0),
     ("Norge 1200", 2006, 2016, "street", 276, 23, 6.0), ("Breva 750 / 1100 / 1200", 2003, 2012, "street", 230, 18, 5.5), ("California", 1981, 2020, "street", 320, 20.5, 6.0),
     ("Eldorado / Audace / MGX-21", 2015, 2020, "street", 340, 20.5, 6.2), ("Quota 1000 / 1100", 1992, 2001, "big", 245, 21, 6.0))

make("CFMoto",
     ("Ibex 450 / 450MT", 2024, NOW, "mid", 190, 17.5, 3.8), ("Ibex 800 / 800MT", 2023, NOW, "big", 231, 19, 4.9), ("800MT Explore", 2024, NOW, "big", 231, 19, 4.9),
     ("650MT", 2018, NOW, "street", 214, 18, 4.5), ("650GT", 2022, NOW, "street", 228, 19, 4.5), ("650NK / 650 NK", 2017, NOW, "street", 206, 17, 4.5),
     ("700CL-X", 2022, NOW, "street", 196, 13, 4.5), ("450CL-C", 2024, NOW, "street", 178, 12, 3.8), ("450SS / 450NK", 2023, NOW, "street", 180, 14, 3.8),
     ("300SS / 300NK", 2021, NOW, "street", 165, 12.5, 3.2), ("675SR / 675NK", 2025, NOW, "street", 199, 15, 4.6), ("450MT-R", 2025, NOW, "mid", 190, 17.5, 3.8))

make("Indian",
     ("FTR 1200", 2019, 2021, "street", 230, 13, 5.8), ("FTR", 2022, NOW, "street", 232, 13, 5.8), ("Scout", 2015, NOW, "street", 251, 12.5, 5.5),
     ("Scout Bobber / Sixty", 2016, NOW, "street", 250, 12.5, 5.5), ("Chief", 2014, NOW, "street", 335, 15.1, 6.0), ("Chieftain", 2014, NOW, "street", 377, 20.8, 6.2),
     ("Roadmaster", 2015, NOW, "street", 412, 20.8, 6.3), ("Springfield", 2016, NOW, "street", 383, 20.8, 6.2), ("Challenger", 2020, NOW, "street", 377, 22.7, 6.2),
     ("Pursuit", 2022, NOW, "street", 413, 22.7, 6.3), ("Super Chief / Vintage", 2014, NOW, "street", 345, 15.1, 6.0), ("Chief (Gilroy)", 1999, 2003, "street", 340, 18, 6.5))

make("Buell",
     ("XB12X Ulysses", 2006, 2010, "big", 215, 16.7, 5.6), ("XB12XT Ulysses", 2008, 2010, "big", 218, 16.7, 5.6), ("XB9SX Lightning CityX", 2005, 2009, "street", 190, 14, 5.4),
     ("XB9 / XB12 Lightning", 2003, 2010, "street", 195, 14, 5.6), ("XB9R / XB12R Firebolt", 2003, 2010, "street", 192, 14, 5.6), ("1125R / 1125CR", 2008, 2010, "street", 197, 21, 6.5),
     ("Blast", 2000, 2009, "street", 163, 10.6, 3.5), ("S1 / X1 / M2 / S3", 1996, 2002, "street", 205, 16.7, 6.0), ("Hammerhead 1190", 2024, NOW, "street", 205, 16, 7.0),
     ("1190SX / 1190RX", 2014, 2019, "street", 193, 16, 7.0))

make("Benelli",
     ("TRK 502", 2018, NOW, "mid", 235, 20, 4.3), ("TRK 502X", 2018, NOW, "mid", 235, 20, 4.3), ("TRK 702 / 702X", 2024, NOW, "mid", 225, 20, 4.8),
     ("TRK 251", 2021, NOW, "light", 179, 18, 3.0), ("Leoncino 500", 2018, NOW, "street", 207, 13.5, 4.2), ("Leoncino 250", 2021, NOW, "street", 165, 12.5, 3.0),
     ("302S / 302R", 2017, NOW, "street", 195, 16, 3.5), ("Imperiale 400", 2021, NOW, "street", 205, 12, 3.0), ("752S", 2020, NOW, "street", 226, 20, 5.0),
     ("TNT 135", 2017, NOW, "street", 128, 7.2, 2.0))

make("Can-Am",
     ("Origin (electric)", 2025, NOW, "light", 177, 0, 0), ("Pulse (electric)", 2025, NOW, "street", 177, 0, 0),
     ("Sonic / ASE / Qualifier 250-500 (old)", 1981, 1987, "enduro", 115, 11, 6.0))

make("Fantic",
     ("XEF 250 Trail", 2022, NOW, "light", 112, 8.5, 4.4), ("XEF 450 Rally", 2023, NOW, "light", 129, 11, 4.5), ("XE 125 / XE 300", 2021, NOW, "enduro", 108, 8.5, 5.5),
     ("XX 125 / XX 250", 2021, NOW, "enduro", 98, 7, 6.5), ("XXF 250 / XXF 450", 2021, NOW, "enduro", 106, 6.5, 6.0), ("Caballero 500 Scrambler", 2018, NOW, "street", 151, 12, 4.0),
     ("Caballero 700", 2025, NOW, "street", 185, 15, 4.8))

make("Husaberg",
     *dirt("", [("FE 250", 2013, 2014, "en250"), ("FE 350", 2013, 2014, "en350"), ("FE 390", 2010, 2012, "en350"), ("FE 450", 2004, 2014, "en450"),
                ("FE 501", 2013, 2014, "en500"), ("FE 550 / 570", 2004, 2012, "en600"), ("FE 650", 2004, 2008, "en600"), ("FX 450", 2010, 2012, "en450"),
                ("TE 125", 2012, 2014, "en125"), ("TE 250", 2011, 2014, "en250t"), ("TE 300", 2011, 2014, "en300t"), ("FS 570 / 650 (supermoto)", 2004, 2012, "en600")]))

make("Hyosung",
     ("GT250 / GT250R", 2004, 2016, "street", 175, 17, 3.5), ("GT650 / GT650R", 2004, 2016, "street", 215, 17, 5.0), ("GV250 Aquila", 2001, 2016, "street", 175, 16, 3.5),
     ("GV650 Aquila", 2005, 2016, "street", 235, 16, 5.0), ("ST7", 2010, 2016, "street", 260, 17, 6.0), ("RT125 Karion", 2004, 2013, "light", 130, 11, 2.5))

make("Kove",
     ("800X Rally", 2023, NOW, "mid", 185, 22, 4.5), ("800X Pro", 2024, NOW, "mid", 188, 22, 4.5), ("450 Rally", 2024, NOW, "light", 145, 21, 4.0),
     ("450 Rally Pro", 2024, NOW, "light", 145, 21, 4.0))

make("Kymco",
     ("AK 550", 2018, NOW, "street", 228, 15, 4.5), ("Xciting 400i / S 400", 2013, NOW, "street", 200, 12.5, 4.0), ("Like 150i", 2016, NOW, "street", 117, 7, 2.5),
     ("People S 150", 2010, NOW, "street", 128, 7, 2.5), ("Agility 50 / 125", 2008, NOW, "street", 105, 5.5, 2.2), ("DT X360", 2022, NOW, "street", 187, 13.5, 3.6))

make("MV Agusta",
     ("Enduro Veloce", 2024, NOW, "big", 230, 20, 5.5), ("Lucky Explorer 5.5", 2025, NOW, "mid", 205, 19, 4.5), ("Turismo Veloce 800", 2015, NOW, "street", 215, 21.5, 5.8),
     ("Brutale 800 / 675", 2013, NOW, "street", 190, 16.5, 6.0), ("Brutale 1000 / 920 / 990 / 1078", 2001, NOW, "street", 205, 16, 7.0), ("Dragster 800", 2014, NOW, "street", 190, 16.5, 6.0),
     ("F3 675 / 800", 2012, NOW, "street", 185, 16.5, 6.5), ("F4", 1999, 2019, "street", 210, 17, 7.5), ("Superveloce", 2020, NOW, "street", 190, 16.5, 6.5),
     ("Rush 1000", 2021, 2022, "street", 210, 16, 7.0))

make("Moto Morini",
     ("X-Cape 650", 2022, NOW, "mid", 233, 18, 4.5), ("X-Cape 700", 2025, NOW, "mid", 225, 18, 4.5), ("Seiemmezzo 650", 2023, NOW, "street", 210, 16, 4.5))

make("Piaggio",
     ("MP3 300 / 400 / 500", 2008, NOW, "street", 260, 12, 4.0), ("Beverly 300 / 400", 2011, NOW, "street", 185, 12, 3.5), ("BV 350", 2013, 2020, "street", 190, 12, 3.5),
     ("Liberty 50 / 150", 2012, NOW, "street", 115, 6, 2.3), ("Medley 150", 2021, NOW, "street", 135, 7, 2.3))

make("Rieju",
     ("MR 250 / 300 Pro", 2021, NOW, "enduro", 104, 9.5, 6.0), ("MR Ranger 300", 2023, NOW, "enduro", 106, 9.5, 6.0), ("Marathon 125", 2010, NOW, "light", 125, 6.8, 2.5),
     ("Aventura 500", 2023, NOW, "mid", 196, 17.5, 3.6))

make("SWM",
     ("SuperDual 600", 2018, NOW, "light", 169, 18.5, 4.5), ("SuperDual T", 2018, NOW, "light", 172, 18.5, 4.5), ("RS 500 R", 2017, NOW, "light", 135, 10, 4.5),
     ("RS 300 R / RS 125 R", 2016, NOW, "enduro", 115, 8, 5.0), ("Gran Milano 440 / Outlaw", 2016, NOW, "street", 151, 13, 4.0), ("Silver Vase 440", 2016, NOW, "street", 152, 13, 4.0))

make("Ural",
     ("Gear Up (sidecar, 2WD)", 1999, NOW, "big", 335, 19, 7.5), ("CT", 2008, NOW, "big", 315, 19, 7.5), ("Ranger", 2008, 2015, "big", 330, 19, 7.5),
     ("Patrol", 2005, 2014, "big", 335, 19, 7.5), ("Sportsman / M70", 2016, NOW, "big", 315, 19, 7.5), ("Tourist / Retro", 1995, 2015, "big", 320, 19, 7.5))

make("Vespa",
     ("GTS 300", 2008, NOW, "street", 160, 8.5, 3.0), ("GTV 300", 2007, NOW, "street", 158, 8.5, 3.0), ("Primavera 50 / 150", 2014, NOW, "street", 118, 8, 2.2),
     ("Sprint 50 / 150", 2014, NOW, "street", 118, 8, 2.2), ("Sei Giorni", 2017, NOW, "street", 158, 8.5, 3.0), ("Elettrica", 2020, NOW, "street", 130, 0, 0),
     ("LX / S 50 / 150", 2005, 2013, "street", 115, 8.5, 2.3), ("GTS 250", 2006, 2012, "street", 155, 9, 3.0))

make("Victory",
     ("Vegas / Vegas Jackpot", 2003, 2017, "street", 300, 17, 6.0), ("Kingpin", 2004, 2013, "street", 315, 17, 6.0), ("Hammer", 2005, 2014, "street", 310, 17, 6.0),
     ("High-Ball / Gunner / Judge", 2012, 2017, "street", 305, 17, 6.0), ("Octane", 2017, 2017, "street", 243, 13, 5.5), ("Cross Country / Cross Roads", 2010, 2017, "street", 345, 22, 6.2),
     ("Magnum", 2015, 2017, "street", 360, 22, 6.2), ("Vision", 2008, 2017, "street", 395, 22, 6.3), ("V92C / V92SC", 1999, 2006, "street", 300, 20, 6.0))

make("Voge",
     ("300 Rally", 2023, NOW, "light", 160, 12, 3.2), ("525DSX", 2023, NOW, "mid", 207, 16.5, 3.8), ("650DSX", 2021, NOW, "mid", 221, 19, 4.5),
     ("DS900X", 2024, NOW, "big", 238, 23, 5.0), ("300AC / 300R", 2021, NOW, "street", 167, 12, 3.2), ("SR4 Max", 2024, NOW, "street", 195, 13, 3.6))

make("Zero",
     ("DSR/X", 2023, NOW, "big", 247, 0, 0), ("DSR", 2016, NOW, "mid", 210, 0, 0), ("DS", 2012, NOW, "mid", 185, 0, 0), ("FX / FXS / FXE", 2013, NOW, "light", 133, 0, 0),
     ("S / SR", 2012, NOW, "street", 199, 0, 0), ("SR/F / SR/S", 2020, NOW, "street", 226, 0, 0), ("XE / XB (2025)", 2025, NOW, "light", 135, 0, 0))

make("Stark",
     ("Varg MX", 2023, NOW, "enduro", 118, 0, 0), ("Varg EX", 2024, NOW, "enduro", 120, 0, 0))

make("TM Racing",
     ("EN 125 / 250 / 300 (2-stroke)", 1990, NOW, "enduro", 104, 8.5, 6.0), ("EN 250F / 300F / 450F / 530F", 2002, NOW, "enduro", 112, 8.5, 5.0),
     ("MX 125 / 250 / 300 / 450F", 1990, NOW, "enduro", 102, 7, 6.5))

make("AJP",
     ("PR7 Adventure", 2018, NOW, "light", 162, 13, 4.0), ("PR5 Enduro / Extreme", 2015, NOW, "light", 127, 6, 3.5))

# Electric bikes have no tank: an 8th number is about the range in km, which the app puts in "Range on a tank".
E_RANGE = {"CE 04": 130, "LiveWire": 150, "Origin (electric)": 145, "Pulse (electric)": 160, "Elettrica": 100, "DSR/X": 200, "DSR": 180, "DS": 150,
           "FX / FXS / FXE": 100, "S / SR": 180, "SR/F / SR/S": 200, "XE / XB (2025)": 80, "Varg MX": 80, "Varg EX": 90}
for rows in M.values():
    for r in rows:
        if r[5] == 0:
            r.append(E_RANGE[r[0]])
    rows.sort(key=lambda r: [int(c) if c.isdigit() else c.lower() for c in __import__("re").split(r"(\d+)", r[0])])
out = {"note": "Make, model, first and last model year (0 = still made), kind, kg ready to ride, tank litres, litres per 100 km (0 = electric, then range km). About the makers' numbers.",
       "makes": dict(sorted(M.items(), key=lambda kv: kv[0].lower()))}
path = os.path.join(os.path.dirname(__file__), "..", "data", "moto-models.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(len(M), "makes,", sum(len(v) for v in M.values()), "models,", os.path.getsize(path), "bytes")
