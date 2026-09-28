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

export const SAMPLE_LIFE = `type,start,title,venue,city,people,notes
birthday,2026-03-21,Mum's 60th birthday,The Ivy,London,Mum;Dad;Sara,Surprise speech went well
gathering,2026-04-11,Book club supper,Home,London,Ana;Tom;Priya,
milestone,2026-06-02,Started new job,Studio North,London,,First day nerves
wedding,2026-07-18,Tom & Ana's wedding,Kew Gardens,London,Tom;Ana,Danced until 1am
memory,2026-09-05,First swim in the lido this year,Brockwell Lido,London,,
`;
