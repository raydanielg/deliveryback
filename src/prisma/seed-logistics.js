// Seeds the destination / airport / vehicle-class catalog. Idempotent: safe to re-run, never
// overwrites values a Super Admin has since edited (rates, blocks, active flags) — it only fills
// in what is missing. Coordinates are approximate town-centre points (good to a few km); Super
// Admin can correct any of them from Dashboard → Destinations.
//
//   node src/prisma/seed-logistics.js
import prisma from "./client.js"

// [region, regional capital, lat, lon]
const REGIONS = [
  ["Arusha", "Arusha", -3.387, 36.683], ["Dar es Salaam", "Dar es Salaam", -6.792, 39.208],
  ["Dodoma", "Dodoma", -6.163, 35.752], ["Geita", "Geita", -2.87, 32.23],
  ["Iringa", "Iringa", -7.77, 35.69], ["Kagera", "Bukoba", -1.331, 31.812],
  ["Katavi", "Mpanda", -6.343, 31.07], ["Kigoma", "Kigoma", -4.877, 29.627],
  ["Kilimanjaro", "Moshi", -3.335, 37.34], ["Lindi", "Lindi", -9.996, 39.714],
  ["Manyara", "Babati", -4.217, 35.75], ["Mara", "Musoma", -1.5, 33.8],
  ["Mbeya", "Mbeya", -8.9, 33.46], ["Morogoro", "Morogoro", -6.821, 37.661],
  ["Mtwara", "Mtwara", -10.273, 40.183], ["Mwanza", "Mwanza", -2.517, 32.9],
  ["Njombe", "Njombe", -9.343, 34.77], ["Pwani", "Kibaha", -6.77, 38.92],
  ["Rukwa", "Sumbawanga", -7.967, 31.617], ["Ruvuma", "Songea", -10.683, 35.65],
  ["Shinyanga", "Shinyanga", -3.66, 33.42], ["Simiyu", "Bariadi", -2.8, 33.98],
  ["Singida", "Singida", -4.816, 34.744], ["Songwe", "Vwawa", -9.1, 32.93],
  ["Tabora", "Tabora", -5.017, 32.8], ["Tanga", "Tanga", -5.069, 39.098],
  ["Mjini Magharibi", "Zanzibar City", -6.165, 39.199], ["Kaskazini Unguja", "Mkokotoni", -5.885, 39.265],
  ["Kusini Unguja", "Koani", -6.28, 39.4], ["Kaskazini Pemba", "Wete", -5.058, 39.729],
  ["Kusini Pemba", "Chake Chake", -5.246, 39.766],
]

// [town, region, lat, lon] — district headquarters and commercial towns outside the regional capitals.
const TOWNS = [
  ["Bagamoyo", "Pwani", -6.443, 38.905], ["Kisarawe", "Pwani", -6.9, 39.04], ["Mkuranga", "Pwani", -7.13, 39.19],
  ["Kibiti", "Pwani", -7.72, 38.95], ["Utete", "Pwani", -7.97, 38.77], ["Mafia", "Pwani", -7.92, 39.66],
  ["Kilwa Masoko", "Lindi", -8.912, 39.51], ["Nachingwea", "Lindi", -10.37, 38.77], ["Liwale", "Lindi", -9.77, 37.93], ["Ruangwa", "Lindi", -10.0, 38.98],
  ["Masasi", "Mtwara", -10.717, 38.8], ["Newala", "Mtwara", -10.94, 39.28],
  ["Tunduru", "Ruvuma", -11.1, 37.35], ["Mbinga", "Ruvuma", -10.93, 35.02], ["Namtumbo", "Ruvuma", -10.55, 36.1],
  ["Makambako", "Njombe", -8.85, 34.83], ["Ludewa", "Njombe", -10.02, 34.65], ["Makete", "Njombe", -9.28, 34.05],
  ["Mafinga", "Iringa", -8.3, 35.29],
  ["Tunduma", "Songwe", -9.3, 32.77], ["Kyela", "Mbeya", -9.58, 33.85], ["Tukuyu", "Mbeya", -9.25, 33.64], ["Chunya", "Mbeya", -8.53, 33.42],
  ["Kilosa", "Morogoro", -6.84, 36.99], ["Ifakara", "Morogoro", -8.13, 36.68], ["Mikumi", "Morogoro", -7.4, 37.0],
  ["Kondoa", "Dodoma", -4.9, 35.78], ["Mpwapwa", "Dodoma", -6.35, 36.48], ["Kongwa", "Dodoma", -6.2, 36.42],
  ["Manyoni", "Singida", -5.75, 34.83], ["Kiomboi", "Singida", -4.45, 34.35],
  ["Kahama", "Shinyanga", -3.84, 32.6], ["Nzega", "Tabora", -4.21, 33.18], ["Igunga", "Tabora", -4.28, 33.88],
  ["Urambo", "Tabora", -5.07, 32.03], ["Sikonge", "Tabora", -5.63, 32.77],
  ["Kasulu", "Kigoma", -4.58, 30.1], ["Kibondo", "Kigoma", -3.59, 30.71], ["Uvinza", "Kigoma", -5.1, 30.38],
  ["Ngara", "Kagera", -2.49, 30.66], ["Biharamulo", "Kagera", -2.63, 31.31], ["Muleba", "Kagera", -1.75, 31.66], ["Kayanga", "Kagera", -1.33, 30.63],
  ["Chato", "Geita", -2.63, 31.76], ["Ushirombo", "Geita", -3.53, 32.06],
  ["Tarime", "Mara", -1.35, 34.37], ["Bunda", "Mara", -2.03, 33.87],
  ["Nansio", "Mwanza", -2.06, 32.92], ["Sengerema", "Mwanza", -2.65, 32.63], ["Misungwi", "Mwanza", -2.85, 33.08], ["Magu", "Mwanza", -2.58, 33.43], ["Ngudu", "Mwanza", -2.93, 33.18],
  ["Maswa", "Simiyu", -3.18, 33.75], ["Meatu", "Simiyu", -3.55, 34.1],
  ["Karatu", "Arusha", -3.33, 35.67], ["Mto wa Mbu", "Arusha", -3.35, 35.85], ["Monduli", "Arusha", -3.3, 36.45], ["Longido", "Arusha", -2.73, 36.68], ["Loliondo", "Arusha", -2.05, 35.62],
  ["Same", "Kilimanjaro", -4.07, 37.73], ["Mwanga", "Kilimanjaro", -3.63, 37.58], ["Bomang'ombe", "Kilimanjaro", -3.25, 37.1],
  ["Korogwe", "Tanga", -5.15, 38.47], ["Handeni", "Tanga", -5.43, 38.02], ["Lushoto", "Tanga", -4.79, 38.29], ["Muheza", "Tanga", -5.17, 38.78], ["Pangani", "Tanga", -5.43, 38.97],
]

// [iata, name, city, countryCode, countryName, lat, lon, scope]
const TZ = ["TZ", "Tanzania", "TANZANIA"]
const EA = "EAST_AFRICA"
const AIRPORTS = [
  ["DAR", "Julius Nyerere International", "Dar es Salaam", ...TZ.slice(0, 2), -6.878, 39.203, TZ[2]],
  ["JRO", "Kilimanjaro International", "Kilimanjaro", ...TZ.slice(0, 2), -3.429, 37.074, TZ[2]],
  ["ZNZ", "Abeid Amani Karume International", "Zanzibar City", ...TZ.slice(0, 2), -6.222, 39.225, TZ[2]],
  ["MWZ", "Mwanza Airport", "Mwanza", ...TZ.slice(0, 2), -2.444, 32.933, TZ[2]],
  ["ARK", "Arusha Airport", "Arusha", ...TZ.slice(0, 2), -3.368, 36.634, TZ[2]],
  ["DOD", "Dodoma Airport", "Dodoma", ...TZ.slice(0, 2), -6.17, 35.753, TZ[2]],
  ["MBI", "Songwe Airport", "Mbeya", ...TZ.slice(0, 2), -8.92, 33.274, TZ[2]],
  ["SGX", "Songea Airport", "Songea", ...TZ.slice(0, 2), -10.683, 35.583, TZ[2]],
  ["TKQ", "Kigoma Airport", "Kigoma", ...TZ.slice(0, 2), -4.884, 29.671, TZ[2]],
  ["BKZ", "Bukoba Airport", "Bukoba", ...TZ.slice(0, 2), -1.333, 31.821, TZ[2]],
  ["MYW", "Mtwara Airport", "Mtwara", ...TZ.slice(0, 2), -10.339, 40.182, TZ[2]],
  ["LKY", "Lake Manyara Airport", "Mto wa Mbu", ...TZ.slice(0, 2), -3.376, 35.818, TZ[2]],
  ["TBO", "Tabora Airport", "Tabora", ...TZ.slice(0, 2), -5.076, 32.833, TZ[2]],
  ["SUT", "Sumbawanga Airport", "Sumbawanga", ...TZ.slice(0, 2), -7.949, 31.611, TZ[2]],
  ["PMA", "Pemba Airport", "Chake Chake", ...TZ.slice(0, 2), -5.257, 39.811, TZ[2]],
  ["IRI", "Iringa Airport (Nduli)", "Iringa", ...TZ.slice(0, 2), -7.669, 35.752, TZ[2]],
  ["TGT", "Tanga Airport", "Tanga", ...TZ.slice(0, 2), -5.092, 39.071, TZ[2]],
  ["SHY", "Shinyanga Airport", "Shinyanga", ...TZ.slice(0, 2), -3.611, 33.5, TZ[2]],
  ["MUZ", "Musoma Airport", "Musoma", ...TZ.slice(0, 2), -1.483, 33.8, TZ[2]],
  ["LDI", "Lindi Airport (Kikwetu)", "Lindi", ...TZ.slice(0, 2), -9.851, 39.759, TZ[2]],
  ["MFA", "Mafia Island Airport", "Mafia", ...TZ.slice(0, 2), -7.917, 39.667, TZ[2]],
  ["KIY", "Kilwa Masoko Airport", "Kilwa Masoko", ...TZ.slice(0, 2), -8.917, 39.508, TZ[2]],
  ["SEU", "Seronera Airstrip", "Seronera", ...TZ.slice(0, 2), -2.458, 34.831, TZ[2]],

  ["NBO", "Jomo Kenyatta International", "Nairobi", "KE", "Kenya", -1.319, 36.928, EA],
  ["WIL", "Wilson Airport", "Nairobi", "KE", "Kenya", -1.322, 36.815, EA],
  ["MBA", "Moi International", "Mombasa", "KE", "Kenya", -4.035, 39.594, EA],
  ["KIS", "Kisumu International", "Kisumu", "KE", "Kenya", -0.086, 34.729, EA],
  ["EDL", "Eldoret International", "Eldoret", "KE", "Kenya", 0.404, 35.239, EA],
  ["MYD", "Malindi Airport", "Malindi", "KE", "Kenya", -3.229, 40.102, EA],
  ["EBB", "Entebbe International", "Entebbe", "UG", "Uganda", 0.042, 32.443, EA],
  ["KGL", "Kigali International", "Kigali", "RW", "Rwanda", -1.969, 30.135, EA],
  ["BJM", "Melchior Ndadaye International", "Bujumbura", "BI", "Burundi", -3.324, 29.319, EA],
  ["JUB", "Juba International", "Juba", "SS", "South Sudan", 4.872, 31.601, EA],
  ["ADD", "Bole International", "Addis Ababa", "ET", "Ethiopia", 8.978, 38.799, EA],
  ["JIB", "Djibouti–Ambouli International", "Djibouti", "DJ", "Djibouti", 11.547, 43.159, EA],
  ["MGQ", "Aden Adde International", "Mogadishu", "SO", "Somalia", 2.014, 45.305, EA],
  ["HGA", "Egal International", "Hargeisa", "SO", "Somalia", 9.518, 44.089, EA],
  ["GOM", "Goma International", "Goma", "CD", "DR Congo", -1.671, 29.239, EA],
  ["FBM", "Lubumbashi International", "Lubumbashi", "CD", "DR Congo", -11.591, 27.531, EA],
  ["FIH", "N'djili International", "Kinshasa", "CD", "DR Congo", -4.386, 15.445, EA],
  ["LLW", "Kamuzu International", "Lilongwe", "MW", "Malawi", -13.789, 33.781, EA],
  ["LUN", "Kenneth Kaunda International", "Lusaka", "ZM", "Zambia", -15.331, 28.453, EA],
  ["HRE", "Robert Gabriel Mugabe International", "Harare", "ZW", "Zimbabwe", -17.932, 31.093, EA],
  ["MPM", "Maputo International", "Maputo", "MZ", "Mozambique", -25.919, 32.573, EA],
  ["HAH", "Prince Said Ibrahim International", "Moroni", "KM", "Comoros", -11.534, 43.27, EA],
  ["MRU", "Sir Seewoosagur Ramgoolam International", "Mauritius", "MU", "Mauritius", -20.43, 57.68, EA],
  ["SEZ", "Seychelles International", "Victoria", "SC", "Seychelles", -4.674, 55.522, EA],

  ["DXB", "Dubai International", "Dubai", "AE", "United Arab Emirates", 25.253, 55.366, "WORLD"],
  ["AUH", "Zayed International", "Abu Dhabi", "AE", "United Arab Emirates", 24.433, 54.651, "WORLD"],
  ["SHJ", "Sharjah International", "Sharjah", "AE", "United Arab Emirates", 25.329, 55.517, "WORLD"],
  ["DOH", "Hamad International", "Doha", "QA", "Qatar", 25.273, 51.608, "WORLD"],
  ["JED", "King Abdulaziz International", "Jeddah", "SA", "Saudi Arabia", 21.68, 39.157, "WORLD"],
  ["RUH", "King Khalid International", "Riyadh", "SA", "Saudi Arabia", 24.958, 46.699, "WORLD"],
  ["MCT", "Muscat International", "Muscat", "OM", "Oman", 23.593, 58.284, "WORLD"],
  ["KWI", "Kuwait International", "Kuwait City", "KW", "Kuwait", 29.227, 47.969, "WORLD"],
  ["BAH", "Bahrain International", "Manama", "BH", "Bahrain", 26.271, 50.634, "WORLD"],
  ["IST", "Istanbul Airport", "Istanbul", "TR", "Türkiye", 41.275, 28.752, "WORLD"],
  ["CAI", "Cairo International", "Cairo", "EG", "Egypt", 30.122, 31.406, "WORLD"],
  ["TLV", "Ben Gurion International", "Tel Aviv", "IL", "Israel", 32.011, 34.887, "WORLD"],
  ["AMM", "Queen Alia International", "Amman", "JO", "Jordan", 31.722, 35.993, "WORLD"],
  ["JNB", "O. R. Tambo International", "Johannesburg", "ZA", "South Africa", -26.139, 28.246, "WORLD"],
  ["CPT", "Cape Town International", "Cape Town", "ZA", "South Africa", -33.965, 18.602, "WORLD"],
  ["LOS", "Murtala Muhammed International", "Lagos", "NG", "Nigeria", 6.577, 3.321, "WORLD"],
  ["ACC", "Kotoka International", "Accra", "GH", "Ghana", 5.605, -0.167, "WORLD"],
  ["LHR", "Heathrow", "London", "GB", "United Kingdom", 51.47, -0.454, "WORLD"],
  ["LGW", "Gatwick", "London", "GB", "United Kingdom", 51.148, -0.19, "WORLD"],
  ["CDG", "Charles de Gaulle", "Paris", "FR", "France", 49.01, 2.548, "WORLD"],
  ["AMS", "Schiphol", "Amsterdam", "NL", "Netherlands", 52.309, 4.764, "WORLD"],
  ["FRA", "Frankfurt Airport", "Frankfurt", "DE", "Germany", 50.033, 8.571, "WORLD"],
  ["BRU", "Brussels Airport", "Brussels", "BE", "Belgium", 50.901, 4.484, "WORLD"],
  ["ZRH", "Zürich Airport", "Zurich", "CH", "Switzerland", 47.458, 8.548, "WORLD"],
  ["MAD", "Adolfo Suárez Madrid–Barajas", "Madrid", "ES", "Spain", 40.472, -3.561, "WORLD"],
  ["FCO", "Leonardo da Vinci–Fiumicino", "Rome", "IT", "Italy", 41.8, 12.239, "WORLD"],
  ["MXP", "Milan Malpensa", "Milan", "IT", "Italy", 45.63, 8.723, "WORLD"],
  ["VIE", "Vienna International", "Vienna", "AT", "Austria", 48.11, 16.57, "WORLD"],
  ["CPH", "Copenhagen Airport", "Copenhagen", "DK", "Denmark", 55.618, 12.656, "WORLD"],
  ["ARN", "Stockholm Arlanda", "Stockholm", "SE", "Sweden", 59.652, 17.919, "WORLD"],
  ["OSL", "Oslo Airport", "Oslo", "NO", "Norway", 60.194, 11.1, "WORLD"],
  ["HEL", "Helsinki Airport", "Helsinki", "FI", "Finland", 60.317, 24.963, "WORLD"],
  ["WAW", "Warsaw Chopin", "Warsaw", "PL", "Poland", 52.166, 20.967, "WORLD"],
  ["ATH", "Athens International", "Athens", "GR", "Greece", 37.936, 23.944, "WORLD"],
  ["JFK", "John F. Kennedy International", "New York", "US", "United States", 40.64, -73.779, "WORLD"],
  ["EWR", "Newark Liberty International", "Newark", "US", "United States", 40.69, -74.175, "WORLD"],
  ["IAD", "Washington Dulles International", "Washington", "US", "United States", 38.944, -77.456, "WORLD"],
  ["ORD", "O'Hare International", "Chicago", "US", "United States", 41.978, -87.905, "WORLD"],
  ["ATL", "Hartsfield–Jackson Atlanta", "Atlanta", "US", "United States", 33.641, -84.428, "WORLD"],
  ["LAX", "Los Angeles International", "Los Angeles", "US", "United States", 33.942, -118.408, "WORLD"],
  ["SFO", "San Francisco International", "San Francisco", "US", "United States", 37.619, -122.375, "WORLD"],
  ["MIA", "Miami International", "Miami", "US", "United States", 25.796, -80.287, "WORLD"],
  ["YYZ", "Toronto Pearson International", "Toronto", "CA", "Canada", 43.677, -79.631, "WORLD"],
  ["GRU", "São Paulo–Guarulhos International", "São Paulo", "BR", "Brazil", -23.435, -46.473, "WORLD"],
  ["EZE", "Ministro Pistarini International", "Buenos Aires", "AR", "Argentina", -34.822, -58.536, "WORLD"],
  ["DEL", "Indira Gandhi International", "Delhi", "IN", "India", 28.556, 77.1, "WORLD"],
  ["BOM", "Chhatrapati Shivaji Maharaj International", "Mumbai", "IN", "India", 19.089, 72.865, "WORLD"],
  ["MAA", "Chennai International", "Chennai", "IN", "India", 12.994, 80.17, "WORLD"],
  ["BLR", "Kempegowda International", "Bengaluru", "IN", "India", 13.199, 77.706, "WORLD"],
  ["CCU", "Netaji Subhas Chandra Bose International", "Kolkata", "IN", "India", 22.655, 88.447, "WORLD"],
  ["KHI", "Jinnah International", "Karachi", "PK", "Pakistan", 24.907, 67.161, "WORLD"],
  ["DAC", "Hazrat Shahjalal International", "Dhaka", "BD", "Bangladesh", 23.843, 90.398, "WORLD"],
  ["CMB", "Bandaranaike International", "Colombo", "LK", "Sri Lanka", 7.18, 79.884, "WORLD"],
  ["BKK", "Suvarnabhumi", "Bangkok", "TH", "Thailand", 13.69, 100.75, "WORLD"],
  ["SIN", "Changi", "Singapore", "SG", "Singapore", 1.359, 103.989, "WORLD"],
  ["KUL", "Kuala Lumpur International", "Kuala Lumpur", "MY", "Malaysia", 2.746, 101.71, "WORLD"],
  ["CGK", "Soekarno–Hatta International", "Jakarta", "ID", "Indonesia", -6.126, 106.656, "WORLD"],
  ["MNL", "Ninoy Aquino International", "Manila", "PH", "Philippines", 14.509, 121.02, "WORLD"],
  ["HKG", "Hong Kong International", "Hong Kong", "HK", "Hong Kong", 22.309, 113.915, "WORLD"],
  ["PVG", "Shanghai Pudong International", "Shanghai", "CN", "China", 31.144, 121.805, "WORLD"],
  ["PEK", "Beijing Capital International", "Beijing", "CN", "China", 40.08, 116.585, "WORLD"],
  ["CAN", "Guangzhou Baiyun International", "Guangzhou", "CN", "China", 23.392, 113.299, "WORLD"],
  ["SZX", "Shenzhen Bao'an International", "Shenzhen", "CN", "China", 22.639, 113.811, "WORLD"],
  ["ICN", "Incheon International", "Seoul", "KR", "South Korea", 37.469, 126.451, "WORLD"],
  ["NRT", "Narita International", "Tokyo", "JP", "Japan", 35.765, 140.386, "WORLD"],
  ["HND", "Haneda", "Tokyo", "JP", "Japan", 35.549, 139.78, "WORLD"],
  ["KIX", "Kansai International", "Osaka", "JP", "Japan", 34.427, 135.244, "WORLD"],
  ["SYD", "Sydney Kingsford Smith", "Sydney", "AU", "Australia", -33.946, 151.177, "WORLD"],
  ["MEL", "Melbourne Airport", "Melbourne", "AU", "Australia", -37.673, 144.843, "WORLD"],
  ["AKL", "Auckland Airport", "Auckland", "NZ", "New Zealand", -37.008, 174.792, "WORLD"],
]

// Starting rate cards — a sensible baseline that Super Admin tunes from the dashboard.
// Boda takes small parcels over short hops, cars/vans mid-size, pickup ~1.5 t, then trucks: a
// heavier load automatically lands on a bigger vehicle because smaller classes exclude it.
const VEHICLE_CLASSES = [
  { code: "BODA", name: "Motorcycle (Boda)", nameSw: "Pikipiki (Boda)", mode: "ROAD", vehicleType: "MOTORCYCLE", maxWeightKg: 15, maxVolumeM3: 0.08, baseFare: 2000, perKm: 250, perKg: 0, includedKg: 15, minCharge: 3000, avgSpeedKmh: 35, handlingHours: 0.5, maxDriveHoursPerDay: 8, maxDistanceKm: 80, sortOrder: 10, description: "Small parcels and documents over short distances." },
  { code: "CAR", name: "Car", nameSw: "Gari ndogo", mode: "ROAD", vehicleType: "CAR", maxWeightKg: 150, maxVolumeM3: 1.2, baseFare: 5000, perKm: 120, perKg: 60, includedKg: 15, minCharge: 8000, avgSpeedKmh: 55, handlingHours: 1.5, maxDriveHoursPerDay: 10, sortOrder: 20, description: "Boxes and mid-size parcels." },
  { code: "VAN", name: "Van", nameSw: "Kirikuu", mode: "ROAD", vehicleType: "VAN", maxWeightKg: 800, maxVolumeM3: 8, baseFare: 10000, perKm: 200, perKg: 40, includedKg: 50, minCharge: 15000, avgSpeedKmh: 50, handlingHours: 2, maxDriveHoursPerDay: 10, sortOrder: 30, description: "Bulk parcels, e-commerce loads." },
  { code: "PICKUP", name: "Pickup (up to 1.5 t)", nameSw: "Pickup (hadi tani 1.5)", mode: "ROAD", vehicleType: "PICKUP", maxWeightKg: 1500, maxVolumeM3: 10, baseFare: 15000, perKm: 350, perKg: 25, includedKg: 100, minCharge: 25000, avgSpeedKmh: 50, handlingHours: 2, maxDriveHoursPerDay: 10, sortOrder: 40, description: "Heavy goods, up to one and a half tonnes." },
  { code: "TRUCK", name: "Truck (up to 10 t)", nameSw: "Lori (hadi tani 10)", mode: "ROAD", vehicleType: "TRUCK", maxWeightKg: 10000, maxVolumeM3: 40, baseFare: 60000, perKm: 900, perKg: 12, includedKg: 1500, minCharge: 90000, avgSpeedKmh: 45, handlingHours: 3, maxDriveHoursPerDay: 10, sortOrder: 50, description: "Commercial cargo and machinery." },
  { code: "TRAILER", name: "Trailer (up to 30 t)", nameSw: "Trela (hadi tani 30)", mode: "ROAD", vehicleType: "TRAILER", maxWeightKg: 30000, maxVolumeM3: 90, baseFare: 150000, perKm: 1500, perKg: 6, includedKg: 10000, minCharge: 250000, avgSpeedKmh: 40, handlingHours: 4, maxDriveHoursPerDay: 10, sortOrder: 60, description: "Full loads and heavy equipment." },
  { code: "SGR_PARCEL", name: "SGR Parcel (train)", nameSw: "SGR (treni)", mode: "RAIL", maxWeightKg: 500, maxVolumeM3: 3, baseFare: 8000, perKm: 300, perKg: 30, includedKg: 5, minCharge: 10000, avgSpeedKmh: 90, handlingHours: 8, maxDriveHoursPerDay: 20, sortOrder: 70, description: "Station-to-station on the SGR line — economical for intercity." },
  { code: "AIR_CARGO", name: "Air cargo", nameSw: "Ndege (mizigo)", mode: "AIR", maxWeightKg: 5000, maxVolumeM3: 30, baseFare: 30000, perKm: 60, perKg: 1500, includedKg: 5, minCharge: 45000, avgSpeedKmh: 650, handlingHours: 24, maxDriveHoursPerDay: 24, sortOrder: 80, description: "Fastest option between airports, domestic and international." },
  { code: "SEA_CONTAINER", name: "Sea freight (container)", nameSw: "Meli (kontena)", mode: "SEA", maxWeightKg: 25000, maxVolumeM3: 67, baseFare: 500000, perKm: 12, perKg: 40, includedKg: 1000, minCharge: 700000, avgSpeedKmh: 30, handlingHours: 96, maxDriveHoursPerDay: 24, sortOrder: 90, description: "Heavy international cargo — slowest, most economical per kg." },
]

const SERVICE_LEVELS = [
  { level: "ECONOMY", label: "Economy", etaFactor: 1.5, priceFactor: 0.85 },
  { level: "STANDARD", label: "Standard", etaFactor: 1, priceFactor: 1 },
  { level: "EXPRESS", label: "Express", etaFactor: 0.65, priceFactor: 1.5 },
  { level: "PRIORITY", label: "Priority", etaFactor: 0.5, priceFactor: 1.7 },
  { level: "NEXT_DAY", label: "Next day", etaFactor: 0.5, priceFactor: 1.8 },
  { level: "SAME_DAY", label: "Same day", etaFactor: 0.35, priceFactor: 2.2 },
]

async function main() {
  const tz = await prisma.country.upsert({ where: { code: "TZ" }, update: {}, create: { code: "TZ", name: "Tanzania", currency: "TZS" } })

  const regionIds = {}
  for (const [name, capital, lat, lon] of REGIONS) {
    let region = await prisma.region.findFirst({ where: { countryId: tz.id, name } })
    if (!region) region = await prisma.region.create({ data: { countryId: tz.id, name } })
    regionIds[name] = region.id

    // Existing city rows (the older seed) are adopted, not duplicated.
    let city = await prisma.city.findFirst({ where: { countryId: tz.id, name: capital } })
    if (!city) city = await prisma.city.create({ data: { countryId: tz.id, regionId: region.id, name: capital, latitude: lat, longitude: lon, kind: "REGIONAL_CAPITAL" } })
    else await prisma.city.update({ where: { id: city.id }, data: { regionId: city.regionId ?? region.id, latitude: city.latitude ?? lat, longitude: city.longitude ?? lon, kind: "REGIONAL_CAPITAL" } })
  }
  // Older seeds used "Kilimanjaro" as a city name for the region's hub — keep it usable too.
  const kili = await prisma.city.findFirst({ where: { countryId: tz.id, name: "Kilimanjaro" } })
  if (kili) await prisma.city.update({ where: { id: kili.id }, data: { regionId: kili.regionId ?? regionIds["Kilimanjaro"], latitude: kili.latitude ?? -3.429, longitude: kili.longitude ?? 37.074 } })

  for (const [name, regionName, lat, lon] of TOWNS) {
    const existing = await prisma.city.findFirst({ where: { countryId: tz.id, name } })
    if (!existing) await prisma.city.create({ data: { countryId: tz.id, regionId: regionIds[regionName], name, latitude: lat, longitude: lon, kind: "TOWN" } })
    else await prisma.city.update({ where: { id: existing.id }, data: { regionId: existing.regionId ?? regionIds[regionName], latitude: existing.latitude ?? lat, longitude: existing.longitude ?? lon } })
  }

  for (const [iata, name, city, countryCode, countryName, latitude, longitude, scope] of AIRPORTS) {
    await prisma.airport.upsert({ where: { iata }, update: {}, create: { iata, name, city, countryCode, countryName, latitude, longitude, scope } })
  }

  for (const vc of VEHICLE_CLASSES) {
    await prisma.vehicleClass.upsert({ where: { code: vc.code }, update: {}, create: vc })
  }
  for (const sl of SERVICE_LEVELS) {
    await prisma.serviceLevelConfig.upsert({ where: { level: sl.level }, update: {}, create: sl })
  }

  const [regions, cities, airports, classes] = await Promise.all([
    prisma.region.count(), prisma.city.count(), prisma.airport.count(), prisma.vehicleClass.count(),
  ])
  console.log({ regions, cities, airports, vehicleClasses: classes })
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
