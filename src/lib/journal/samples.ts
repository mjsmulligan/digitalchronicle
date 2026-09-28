export const SAMPLE_FR24 = `Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note,Dep_id,Arr_id,Airline_id,Aircraft_id
2026-05-14,BA982,London / Heathrow (LHR/EGLL),Berlin / Brandenburg (BER/EDDB),07:25:00,10:15:00,01:50:00,British Airways (BA/BAW),Airbus A320neo (A20N),G-TTNA,14A,1,1,1,Window seat over the Channel,1,2,3,4
2026-05-20,EZY8546,Amsterdam / Schiphol (AMS/EHAM),London / Gatwick (LGW/EGKK),18:40:00,19:05:00,01:25:00,easyJet (U2/EZY),Airbus A319 (A319),G-EZBI,7F,1,1,1,,1,2,3,4
2026-08-02,JL44,London / Heathrow (LHR/EGLL),Tokyo / Haneda (HND/RJTT),19:30:00,17:25:00,13:55:00,Japan Airlines (JL/JAL),Boeing 787-9 (B789),JA861J,22K,1,1,1,Overnight,1,2,3,4
2026-08-11,JL43,Tokyo / Haneda (HND/RJTT),London / Heathrow (LHR/EGLL),11:05:00,16:30:00,14:25:00,Japan Airlines (JL/JAL),Boeing 777-300ER (B77W),JA731J,31A,1,1,1,,1,2,3,4
`;

export const SAMPLE_VIADUCT = `Date,Origin,Destination,Departure time,Arrival time,Operator,Train number,Seat,Notes
2026-05-17,Berlin Hbf,Hamburg Hbf,09:34,11:20,DB,ICE 703,Coach 5 / 61,Quiet coach
2026-05-19,Hamburg Hbf,Amsterdam Centraal,10:21,15:39,DB,IC 145,Coach 3 / 22,
2026-08-06,Tokyo,Kyoto,08:00,10:15,JR Central,Nozomi 7,Car 12 / 3E,Fuji visible on the right
2026-08-09,Kyoto,Tokyo,16:30,18:45,JR Central,Nozomi 238,Car 8 / 14A,
`;

export const SAMPLE_SETLIST = JSON.stringify(
  [
    {
      eventDate: "15-05-2026",
      artist: { name: "Caribou" },
      venue: { name: "Tempodrom", city: { name: "Berlin", country: { name: "Germany" } } },
      tour: { name: "Honey Tour" },
      sets: { set: [{ song: [{ name: "Sun" }, { name: "Odessa" }, { name: "Can't Do Without You" }, { name: "Home" }] }] },
    },
    {
      eventDate: "18-05-2026",
      artist: { name: "Kraftwerk" },
      venue: { name: "Elbphilharmonie", city: { name: "Hamburg", country: { name: "Germany" } } },
      sets: { set: [{ song: [{ name: "Numbers" }, { name: "Computer World" }, { name: "Autobahn" }, { name: "Trans-Europe Express" }] }] },
    },
    {
      eventDate: "07-08-2026",
      artist: { name: "Cornelius" },
      venue: { name: "Rohm Theatre", city: { name: "Kyoto", country: { name: "Japan" } } },
      sets: { set: [{ song: [{ name: "Star Fruits Surf Rider" }, { name: "Point of View Point" }, { name: "Drop" }] }] },
    },
  ],
  null,
  2,
);

export const SAMPLE_GENERIC = `type,start,end,place,city,notes,tier
stay,2026-05-14,2026-05-17,Michelberger Hotel,Berlin,Room 212 facing the Spree,3
stay,2026-05-17,2026-05-19,25hours Altes Hafenamt,Hamburg,,3
stay,2026-08-03,2026-08-06,Trunk Hotel,Tokyo,,3
stay,2026-08-06,2026-08-09,Ace Hotel,Kyoto,,3
`;
