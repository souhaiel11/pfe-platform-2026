package fixture;
import java.sql.*;
public final class Smoke {
 public static int answer() throws Exception {
  Class.forName("org.h2.Driver");
  try (Connection c=DriverManager.getConnection("jdbc:h2:mem:retry_fixture")) {
   try (Statement s=c.createStatement(); ResultSet r=s.executeQuery("SELECT 42")) { r.next(); return r.getInt(1); }
  }
 }
}
