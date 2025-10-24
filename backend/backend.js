import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const dbConfig = {
  host: "",
  port: 3306,
  user: "admin",
  password: "",
  database: ""
};

const JWT_SECRET = "YourSuperSecretKey123!";

function generateToken(user) {
  return jwt.sign({ user_id: user.user_id, role: user.role }, JWT_SECRET, { expiresIn: "2h" });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*"
    },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
      },
      body: ""
    };
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    const path = event.requestContext.http.path;
    const method = event.requestContext.http.method;

    // --- User Registration ---
    if (path === "/register" && method === "POST") {
      const body = JSON.parse(event.body);
      const hashed = await bcrypt.hash(body.password, 10);
      await connection.execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
        [body.name, body.email, hashed, body.role || "user"]
      );
      return response(200, { message: "User registered successfully" });
    }

    // --- User Login ---
    if (path === "/login" && method === "POST") {
      const body = JSON.parse(event.body);
      const [rows] = await connection.execute(
        "SELECT * FROM users WHERE email = ?",
        [body.email]
      );
      if (rows.length === 0) return response(401, { error: "Invalid email or password" });

      const user = rows[0];
      const valid = await bcrypt.compare(body.password, user.password_hash);
      if (!valid) return response(401, { error: "Invalid email or password" });

      const token = generateToken(user);
      return response(200, { token, role: user.role });
    }

    // --- Authenticate JWT for all other routes ---
    if (path !== "/login" && path !== "/register") {
      const authHeader = event.headers.Authorization || event.headers.authorization;
      if (!authHeader) return response(401, { error: "Missing Authorization header" });
      const token = authHeader.replace("Bearer ", "");
      const user = verifyToken(token);
      if (!user) return response(401, { error: "Invalid or expired token" });

      // ---- Movies ----
      if (path === "/movies" && method === "GET") {
        const [rows] = await connection.execute("SELECT * FROM movies");
        return response(200, rows);
      }

      if (path === "/movies" && method === "POST") {
        if (user.role !== "admin") return response(403, { error: "Forbidden" });
        
        const body = JSON.parse(event.body);
      
        // Ensure base_price is a number, default to 0 if missing
        const basePrice = body.base_price ? Number(body.base_price) : 50;
      
        await connection.execute(
          "INSERT INTO movies (title, description, base_price) VALUES (?, ?, ?)",
          [body.title, body.description, basePrice]
        );
      
        return response(200, { message: "Movie added with base price" });
      }
      

      // ---- Delete Movie (admin only) ----
if (path.startsWith("/movies/") && method === "DELETE") {
  if (user.role !== "admin") return response(403, { error: "Forbidden" });

  const movieId = path.split("/")[2];
  
  // Optional: Check if movie exists
  const [movieRows] = await connection.execute(
    "SELECT * FROM movies WHERE movie_id = ?",
    [movieId]
  );

  if (movieRows.length === 0) return response(404, { error: "Movie not found" });

  // Delete all related showtimes and seats first to maintain integrity
  const [showtimes] = await connection.execute(
    "SELECT showtime_id FROM showtimes WHERE movie_id = ?",
    [movieId]
  );

  for (const showtime of showtimes) {
    await connection.execute("DELETE FROM seats WHERE showtime_id = ?", [showtime.showtime_id]);
    await connection.execute("DELETE FROM bookings WHERE showtime_id = ?", [showtime.showtime_id]);
  }

  await connection.execute("DELETE FROM showtimes WHERE movie_id = ?", [movieId]);
  await connection.execute("DELETE FROM movies WHERE movie_id = ?", [movieId]);

  return response(200, { message: "Movie and all related data deleted successfully" });
}
// ---- Delete Showtime (admin only) ----
if (path.startsWith("/showtimes/") && method === "DELETE") {
  if (user.role !== "admin") return response(403, { error: "Forbidden" });

  const showtimeId = path.split("/")[2];

  // Check if showtime exists
  const [showtimeRows] = await connection.execute(
    "SELECT * FROM showtimes WHERE showtime_id = ?",
    [showtimeId]
  );
  if (showtimeRows.length === 0) return response(404, { error: "Showtime not found" });

  // Delete related seats and bookings
  await connection.execute("DELETE FROM seats WHERE showtime_id = ?", [showtimeId]);
  await connection.execute("DELETE FROM bookings WHERE showtime_id = ?", [showtimeId]);

  // Delete the showtime itself
  await connection.execute("DELETE FROM showtimes WHERE showtime_id = ?", [showtimeId]);

  return response(200, { message: "Showtime and all related seats/bookings deleted successfully" });
}



      // ---- Showtimes ----
      if (path === "/showtimes" && method === "POST") {
        if (user.role !== "admin") return response(403, { error: "Forbidden" });
      
        const body = JSON.parse(event.body || "{}");
      
        // --- Resolve movie_id ---
        let movie_id = body.movie_id || null;
        if (!movie_id) {
          const title = body.movie_title || body.movie_name;
          if (title) {
            const [mrows] = await connection.execute(
              "SELECT movie_id FROM movies WHERE title = ?",
              [title]
            );
            if (mrows.length) movie_id = mrows[0].movie_id;
          }
        }
        if (!movie_id) return response(400, { error: "movie_id (or valid movie_title/movie_name) is required" });
      
        // --- Determine show_date and show_time ---
        let show_date = body.show_date || null;
        let show_time = body.show_time || null;
      
        if ((!show_date || !show_time) && body.start_time) {
          const dt = new Date(body.start_time);
          if (!isNaN(dt.getTime())) {
            show_date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            show_time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
          }
        }
      
        if (!show_date || !show_time) {
          return response(400, { error: "show_date and show_time are required" });
        }
      
        // --- Insert showtime ---
        const [ins] = await connection.execute(
          "INSERT INTO showtimes (movie_id, show_date, show_time) VALUES (?, ?, ?)",
          [movie_id, show_date, show_time]
        );
        const showtimeId = ins.insertId;
      
        // --- Generate seats automatically ---
        const seatStmt = "INSERT INTO seats (showtime_id, row_label, seat_number, is_booked) VALUES (?, ?, ?, ?)";
        const rows = ["A","B","C","D","E","F","G","H","I","J"];
        const seatsPerRow = 10;
      
        for (const row of rows) {
          for (let num = 1; num <= seatsPerRow; num++) {
            await connection.execute(seatStmt, [showtimeId, row, num, false]);
          }
        }
      
        return response(200, { message: "Showtime added with auto-generated seats", showtime_id: showtimeId });
      }
      
      
      

      // ---- Book Ticket (user) ----
      if (path === "/book" && method === "POST") {
        if (user.role !== "user") return response(403, { error: "Forbidden" });
      
        const body = JSON.parse(event.body);
      
        if (!body.showtime_id || !Array.isArray(body.seat_ids) || body.seat_ids.length === 0) {
          return response(400, { error: "showtime_id and seat_ids are required" });
        }
      
        // Seat category multipliers
        const categoryMultipliers = {
          VIP: 1.5,
          Balcony: 1.25,
          Premium: 1.2,
          Normal: 1.0,
          Front: 0.8
        };
      
        // Map row to category
        function rowToCategory(row) {
          if (["A","B"].includes(row)) return "VIP";
          if (["C","D"].includes(row)) return "Balcony";
          if (["E","F"].includes(row)) return "Premium";
          if (["G","H"].includes(row)) return "Normal";
          if (["I","J"].includes(row)) return "Front";
          return "Unknown";
        }
      
        let connection;
        try {
          connection = await mysql.createConnection(dbConfig);
          await connection.beginTransaction();
      
          const placeholders = body.seat_ids.map(() => "?").join(",");
      
          // 1 Lock selected seats and check availability
          const [selectedSeats] = await connection.execute(
            `SELECT seat_id, row_label, is_booked 
             FROM seats 
             WHERE showtime_id = ? AND seat_id IN (${placeholders}) 
             FOR UPDATE`,
            [body.showtime_id, ...body.seat_ids]
          );
      
          const bookedSeats = selectedSeats.filter(s => s.is_booked).map(s => s.seat_id);
          if (bookedSeats.length > 0) {
            await connection.rollback();
            return response(400, { error: "Some seats are already booked", bookedSeats });
          }
      
          // 2 Fetch movie base price
          const [movieRows] = await connection.execute(
            `SELECT m.base_price 
             FROM showtimes s 
             JOIN movies m ON s.movie_id = m.movie_id 
             WHERE s.showtime_id = ?`,
            [body.showtime_id]
          );
      
          if (movieRows.length === 0) {
            await connection.rollback();
            return response(404, { error: "Showtime not found" });
          }
      
          const basePrice = movieRows[0].base_price;
      
          // 3 Calculate total amount
          const totalAmount = selectedSeats.reduce((sum, seat) => {
            const category = rowToCategory(seat.row_label);
            const multiplier = categoryMultipliers[category] || 1;
            return sum + basePrice * multiplier;
          }, 0);
      
          // 4 Mark seats as booked
          for (let seatId of body.seat_ids) {
            await connection.execute(
              "UPDATE seats SET is_booked = TRUE WHERE seat_id = ? AND showtime_id = ?",
              [seatId, body.showtime_id]
            );
          }
      
          // 5 Create booking with amount and hash
          const bookingId = Date.now().toString();
          const hash = crypto.createHash("sha256")
            .update(bookingId + Date.now().toString())
            .digest("hex");
      
          await connection.execute(
            "INSERT INTO bookings (booking_id, user_id, showtime_id, seats, amount, hash) VALUES (?, ?, ?, ?, ?, ?)",
            [bookingId, user.user_id, body.showtime_id, JSON.stringify(body.seat_ids), totalAmount, hash]
          );
      
          // Commit transaction
          await connection.commit();
      
          const [ticketDetails] = await connection.execute(
            `SELECT u.name AS userName, 
                    m.title AS movieName, 
                    s.show_date AS showDate, 
                    s.show_time AS showTime 
             FROM users u
             JOIN bookings b ON u.user_id = b.user_id
             JOIN showtimes s ON b.showtime_id = s.showtime_id
             JOIN movies m ON s.movie_id = m.movie_id
             WHERE b.booking_id = ?`,
            [bookingId]
          );
          
          const ticket = {
            bookingId,
            userName: ticketDetails[0].userName,
            movieName: ticketDetails[0].movieName,
            showDate: ticketDetails[0].showDate,
            showTime: ticketDetails[0].showTime,
            seats: body.seat_ids,
            totalAmount,
            hash
          };
          
          return response(200, { ticket });
      
        } catch (err) {
          if (connection) await connection.rollback();
          console.error(err);
          return response(500, { error: "Booking failed, please try again" });
        } finally {
          if (connection) await connection.end();
        }
      }
      
      

      // ---- Verify Ticket (staff only) ----
if (path === "/verify" && method === "POST") {
  if (user.role !== "staff") return response(403, { error: "Forbidden: Only staff can verify tickets" });

  const body = JSON.parse(event.body);

  // Validate input
  if (!body.hash) {
    return response(400, { error: "Booking hash is required" });
  }

  // Find booking by hash
  const [rows] = await connection.execute(
    "SELECT * FROM bookings WHERE hash = ?",
    [body.hash]
  );

  if (rows.length === 0) return response(404, { error: "Ticket not found" });

  return response(200, { valid: true, booking: rows[0] });
}


      // ---- Cancel Booking (admin only) ----
      if (path.startsWith("/cancel/") && method === "DELETE") {
        if (user.role !== "admin") return response(403, { error: "Forbidden" });
        const bookingId = path.split("/")[2];
        await connection.execute("DELETE FROM bookings WHERE booking_id = ?", [bookingId]);
        return response(200, { message: "Booking cancelled" });
      }

      // ---- Get All Bookings (admin only) ----
      if (path === "/bookings" && method === "GET") {
        const { user_id, role } = user; // decoded from JWT/session
      
        if (role === "admin") {
          // Admin: all bookings
          const [rows] = await connection.execute("SELECT * FROM bookings");
          return response(200, rows);
        }
      
        if (role === "user") {
          if (!user_id) {
            return response(400, { error: "User ID is missing" });
          }
      
          // User: only their bookings
          const [rows] = await connection.execute(
            "SELECT * FROM bookings WHERE user_id = ?",
            [user_id]
          );
          return response(200, rows);
        }
      
        return response(403, { error: "Forbidden" });
      }
      
      
      
      

      // ---- Analytics (admin only) ----
      if (path === "/analytics" && method === "GET") {
        if (user.role !== "admin") return response(403, { error: "Forbidden" });
      
        const analytics = {};
      
        // 1 Total bookings
        const [bookingCount] = await connection.execute(
          "SELECT COUNT(*) AS totalBookings FROM bookings"
        );
        analytics.totalBookings = bookingCount[0].totalBookings;
      
        // 2 Total sales
        const [sales] = await connection.execute(
          "SELECT SUM(amount) AS totalSales FROM bookings"
        );
        analytics.totalSales = sales[0].totalSales || 0;
      
        // 3 Top customer by total spend
        const [topCustomer] = await connection.execute(`
          SELECT u.user_id, u.name, SUM(b.amount) AS totalSpent
          FROM bookings b
          JOIN users u ON b.user_id = u.user_id
          GROUP BY u.user_id, u.name
          ORDER BY totalSpent DESC
          LIMIT 1
        `);
        analytics.topCustomer = topCustomer[0] || null;
      
        // 4 Highest single booking
        const [highestBooking] = await connection.execute(`
          SELECT b.booking_id, b.user_id, b.showtime_id, b.seats, b.amount, b.created_at
          FROM bookings b
          ORDER BY b.amount DESC
          LIMIT 1
        `);
        analytics.highestBooking = highestBooking[0] || null;
      
        // 5 Top performing movie by number of bookings
        const [topMovie] = await connection.execute(`
          SELECT m.movie_id, m.title, COUNT(b.booking_id) AS bookingCount
          FROM bookings b
          JOIN showtimes s ON b.showtime_id = s.showtime_id
          JOIN movies m ON s.movie_id = m.movie_id
          GROUP BY m.movie_id, m.title
          ORDER BY bookingCount DESC
          LIMIT 1
        `);
        analytics.topMovie = topMovie[0] || null;
      
        return response(200, analytics);
      }
      
     

    }

    return response(404, { error: "Route not found" });

  } catch (err) {
    console.error(err);
    return response(500, { error: err.message });
  } finally {
    if (connection) await connection.end();
  }
}
