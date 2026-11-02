package fixture;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
public final class App {
  public static int smoke() throws Exception {
    Class.forName("org.h2.Driver");
    try (Connection c = DriverManager.getConnection("jdbc:h2:mem:fixture", "sa", "");
         Statement s = c.createStatement(); ResultSet r = s.executeQuery("SELECT 42")) {
      if (!r.next()) throw new IllegalStateException("Missing database result");
      return r.getInt(1);
    }
  }
}
